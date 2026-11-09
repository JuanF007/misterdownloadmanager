//! The browser's quality menu over a video (the extension's button, crates/nmhost): MDM looks
//! the video up with yt-dlp on a thread of its own and answers at once with a token
//! (`video_lookup`); the browser asks how it goes (`video_poll`) and sends the choice made there
//! (`video_pick`), a place in the list MDM offered, which MDM downloads with its own selector for
//! it and the look-up's own browser context. Nothing is shared between look-ups (a private
//! window's never meets another's, a failure is never reused), and none is kept past 10 minutes.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use mdm_ipc::api::{VideoChoice, VideoLookupAnswer, lookup};
use mdm_tools::resolve::{Choice, Looked, Video};
use mdm_tools::video::Subs;

use crate::videodlg::VideoAdd;

/// How long a look-up's token is kept.
pub const TTL: Duration = Duration::from_secs(10 * 60);
/// Look-ups kept at once; a new one makes room by forgetting the oldest.
pub const KEPT: usize = 20;
/// yt-dlp look-ups running at once; one more is answered `busy`.
pub const RUNNING: usize = 2;
/// Choices offered at most (a page has a handful; the browser's messages are capped at 1 MB).
const CHOICES: usize = 64;
/// The longest title and message sent to the browser.
const TITLE_MAX: usize = 300;
const MESSAGE_MAX: usize = 2000;

/// Where a look-up is.
#[derive(Debug, Default)]
pub enum Found {
    #[default]
    Looking,
    /// A video, with the choices offered for it (none: nothing this can download).
    Video(Video, Vec<Choice>),
    /// A list of videos (a playlist, a channel): chosen from in MDM's window.
    List,
    /// yt-dlp's error.
    Failed(String),
}

impl Found {
    /// What yt-dlp's look-up found, with the choices the Download video window offers for it
    /// (merged qualities when `merge`: ffmpeg is there).
    pub fn of(res: Result<Looked, String>, merge: bool) -> Found {
        match res {
            Ok(Looked::Video(v)) => {
                let choices = mdm_tools::resolve::choices(&v, merge);
                Found::Video(v, choices)
            }
            Ok(Looked::List(_)) => Found::List,
            Err(e) => Found::Failed(e),
        }
    }
}

/// A look-up's state: written by its thread, read by the questions about it.
pub type Shared = Arc<Mutex<Found>>;

/// The state, even when a thread panicked holding it (it only ever writes a whole value).
fn lock(found: &Shared) -> MutexGuard<'_, Found> {
    found.lock().unwrap_or_else(PoisonError::into_inner)
}

/// One look-up.
struct Search {
    /// What yt-dlp looks up.
    address: String,
    /// The browser's request context it came with ([`context_of`]): yt-dlp's, then its
    /// download's.
    context: mdm_ipc::Command,
    /// The browser's cookie store it came from.
    store_id: Option<String>,
    created: Instant,
    found: Shared,
}

/// A running look-up's place among the [`RUNNING`]: given back when dropped, however its
/// thread ends.
pub struct Running(Arc<AtomicUsize>);

impl Drop for Running {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// A look-up to run on a thread of its own ([`run`]).
pub struct Job {
    pub token: String,
    pub address: String,
    /// yt-dlp's view of the look-up's browser context.
    pub browser: mdm_tools::proc::FromBrowser,
    pub found: Shared,
    pub running: Running,
}

/// A choice made in the browser that fits its look-up.
#[derive(Debug)]
pub struct Picked {
    pub address: String,
    pub context: mdm_ipc::Command,
    pub video: Video,
    pub choice: Choice,
}

/// The look-ups the browser's quality menu asked for (`App::lookups`).
#[derive(Default)]
pub struct Lookups {
    searches: HashMap<String, Search>,
    running: Arc<AtomicUsize>,
}

impl Lookups {
    /// Look `ask` up with yt-dlp `exe` and the browser's context of `cmd` (`rt`: for a plain
    /// file's server): answered at once, `pending` with its token (`busy` while [`RUNNING`] run
    /// already).
    pub fn start(
        &mut self,
        ask: &mdm_ipc::VideoLookup,
        cmd: &mdm_ipc::Command,
        exe: PathBuf,
        rt: tokio::runtime::Handle,
        now: Instant,
    ) -> VideoLookupAnswer {
        let Some(job) = self.begin(ask, cmd, now) else {
            return VideoLookupAnswer::of(lookup::BUSY);
        };
        let (token, found) = (job.token.clone(), job.found.clone());
        match run(job, exe, rt) {
            Ok(()) => VideoLookupAnswer::pending(&token),
            // No thread for it (its place came back with the job): said as yt-dlp's error is.
            Err(e) => {
                *lock(&found) = Found::Failed(e.to_string());
                self.poll(&token, now)
            }
        }
    }

    /// A new look-up of `ask` with the browser's context of `cmd`, for the caller to run
    /// ([`run`]); none (`busy`) while [`RUNNING`] run already.
    pub fn begin(
        &mut self,
        ask: &mdm_ipc::VideoLookup,
        cmd: &mdm_ipc::Command,
        now: Instant,
    ) -> Option<Job> {
        self.prune(now);
        // Only this (the window's) thread takes places; the look-ups' threads only give them
        // back, so the count can't pass RUNNING between the check and the taking.
        if self.running.load(Ordering::SeqCst) >= RUNNING {
            return None;
        }
        self.running.fetch_add(1, Ordering::SeqCst);
        let running = Running(self.running.clone());
        while self.searches.len() >= KEPT {
            let oldest = self
                .searches
                .iter()
                .min_by_key(|(_, s)| s.created)
                .map(|(t, _)| t.clone());
            match oldest {
                Some(t) => self.searches.remove(&t),
                None => break,
            };
        }
        let token = mdm_ipc::random_token();
        let context = context_of(ask, cmd);
        let address = context.video_page.clone().unwrap_or_default();
        let found = Shared::default();
        let job = Job {
            token: token.clone(),
            address: address.clone(),
            browser: crate::videodlg::from_browser(&context),
            found: found.clone(),
            running,
        };
        self.searches.insert(
            token,
            Search {
                address,
                context,
                store_id: store(&ask.store_id),
                created: now,
                found,
            },
        );
        Some(job)
    }

    /// How look-up `token` goes (`gone`: never given, or forgotten).
    pub fn poll(&mut self, token: &str, now: Instant) -> VideoLookupAnswer {
        self.prune(now);
        match self.searches.get(token) {
            Some(s) => answer(token, s),
            None => VideoLookupAnswer::of(lookup::GONE),
        }
    }

    /// The choice `pick` made in the browser (from a private window: `private`), if it fits
    /// its look-up: found, one of the choices offered, from the same kind of window and the
    /// same cookie store. Taken once: the look-up is forgotten then.
    pub fn pick(
        &mut self,
        pick: &mdm_ipc::VideoPick,
        private: bool,
        now: Instant,
    ) -> Option<Picked> {
        self.prune(now);
        let s = self.searches.get(&pick.token)?;
        if s.context.private != private || s.store_id != store(&pick.store_id) {
            return None;
        }
        if pick.choice >= CHOICES {
            return None;
        }
        let (video, choice) = match &*lock(&s.found) {
            Found::Video(v, choices) => (v.clone(), choices.get(pick.choice)?.clone()),
            _ => return None,
        };
        let s = self.searches.remove(&pick.token)?;
        Some(Picked {
            address: s.address,
            context: s.context,
            video,
            choice,
        })
    }

    fn prune(&mut self, now: Instant) {
        self.searches
            .retain(|_, s| now.saturating_duration_since(s.created) < TTL);
    }
}

/// A cookie store's name, none when blank.
fn store(s: &Option<String>) -> Option<String> {
    s.as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// `s` cut to `max` characters.
fn cut(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// The browser's request context a look-up keeps, for yt-dlp and then its download (as the
/// Download video window keeps the click's): the address looked up (as the window looks it up,
/// `pages::video_address`), the page's referrer, cookies and User-Agent, whether from a private
/// window, and the page's title (a video yt-dlp knows only by its address is named by it, #345).
pub fn context_of(ask: &mdm_ipc::VideoLookup, cmd: &mdm_ipc::Command) -> mdm_ipc::Command {
    mdm_ipc::Command {
        video_page: Some(mdm_tools::pages::video_address(&ask.address)),
        video_title: ask
            .title
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(|t| cut(t, TITLE_MAX)),
        referer: cmd.referer.clone(),
        cookies: cmd.cookies.clone(),
        cookie_jar: cmd.cookie_jar.clone(),
        user_agent: cmd.user_agent.clone(),
        private: cmd.private,
        ..Default::default()
    }
}

/// The title video `v`, looked up at `address` with the browser's `context`, is offered and
/// saved under, as the Download video window names it: the page's when yt-dlp knows it only by
/// that address (#345), else yt-dlp's.
fn title_of<'a>(v: &'a Video, address: &str, context: &'a mdm_ipc::Command) -> &'a str {
    crate::videodlg::page_title(context, v, address).unwrap_or(&v.title)
}

/// The answer for look-up `token` as it stands: the choices labelled in MDM's language, an
/// error in its words (as the Download video window says them).
fn answer(token: &str, s: &Search) -> VideoLookupAnswer {
    match &*lock(&s.found) {
        Found::Looking => VideoLookupAnswer::pending(token),
        Found::Video(_, choices) if choices.is_empty() => {
            VideoLookupAnswer::failed(lookup::NO_CHOICES, None)
        }
        Found::Video(v, choices) => VideoLookupAnswer {
            token: Some(token.to_owned()),
            title: Some(cut(title_of(v, &s.address, &s.context), TITLE_MAX)),
            choices: choices
                .iter()
                .take(CHOICES)
                .map(|c| VideoChoice {
                    label: crate::videodlg::choice_label(&c.label),
                    ext: c.ext.clone(),
                    size: c.size,
                })
                .collect(),
            ..VideoLookupAnswer::of(lookup::READY)
        },
        Found::List => VideoLookupAnswer::of(lookup::LIST),
        Found::Failed(e) => {
            // Whose cookies the look-up had (#229): the extension's, or (none came) those of
            // the browser Options names.
            let sent = s
                .context
                .cookies
                .as_deref()
                .is_some_and(|c| !c.trim().is_empty());
            let store = (!sent).then(mdm_tools::proc::browser_cookies).flatten();
            let message = crate::videodlg::lookup_error(e, sent, store.as_ref());
            VideoLookupAnswer::failed(lookup::ERROR, Some(cut(&message, MESSAGE_MAX)))
        }
    }
}

/// The download choice `p` adds, into `folder` (the Video category's): MDM's own selector for
/// it, the file named as the Download video window names it, the subtitles that window would
/// preselect from `pref` (settings.video_subs, not changed by it), started now unless
/// `start_now` is false (Options: only add to the queue). None for an address MDM can't take.
pub fn video_add(p: Picked, folder: &Path, start_now: bool, pref: &Subs) -> Option<VideoAdd> {
    let page = url::Url::parse(&p.address)
        .ok()
        .filter(|u| matches!(u.scheme(), "http" | "https"))?;
    let name = crate::videodlg::file_name(title_of(&p.video, &p.address, &p.context), &p.choice);
    Some(VideoAdd {
        page,
        selector: p.choice.selector.clone(),
        dest: folder.join(mdm_engine::naming::sanitize(name.trim())),
        size: p.choice.size,
        start_now,
        subs: crate::videodlg::default_subs(&p.video, &p.choice, pref),
        context: p.context,
        remember: None,
    })
}

/// Run `job` with yt-dlp `exe` on a thread of its own, as the Download video window looks a
/// video up (`rt`: a plain file's size from its server): its state written when yt-dlp answers
/// (within its 90 s), its place given back as the thread ends. A look-up forgotten meanwhile
/// (10 minutes, or 20 newer ones) ends all the same, with nothing to read it.
pub fn run(job: Job, exe: PathBuf, rt: tokio::runtime::Handle) -> std::io::Result<()> {
    std::thread::Builder::new()
        .name("mdm-video-lookup".into())
        .spawn(move || {
            let Job {
                address,
                browser,
                found,
                running,
                ..
            } = job;
            let res = crate::videodlg::look_up(&exe, &address, &browser, &rt);
            // The qualities that need merging, when ffmpeg is there (as the window offers them).
            let merge = mdm_tools::tools_dir()
                .as_deref()
                .and_then(mdm_tools::ffmpeg::installed)
                .is_some();
            *lock(&found) = Found::of(res, merge);
            drop(running);
        })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use mdm_ipc::{Command, VideoLookup, VideoPick};

    /// A stream's manifest as yt-dlp sees it (named after its address) with two variants and
    /// German subtitles.
    const STREAM: &str = r#"{"title": "master", "duration": 60, "formats": [
        {"format_id": "hls-2500", "ext": "mp4", "height": 720, "vcodec": "avc1", "acodec": "mp4a", "tbr": 2500},
        {"format_id": "hls-800", "ext": "mp4", "height": 360, "vcodec": "avc1", "acodec": "mp4a", "tbr": 800}],
        "subtitles": {"de": [{"name": "German"}]}}"#;
    const SRC: &str = "https://cdn.test/v/hls/master.m3u8";
    const PAGE: &str = "https://videos.test/watch?v=1";

    fn look(address: &str, title: Option<&str>, store: Option<&str>) -> VideoLookup {
        VideoLookup {
            address: address.into(),
            title: title.map(str::to_owned),
            store_id: store.map(str::to_owned),
        }
    }

    /// The host's command: the browser's context with the look-up.
    fn sent(private: bool, cookies: &str) -> Command {
        Command {
            referer: Some(PAGE.into()),
            cookies: Some(cookies.into()),
            user_agent: Some("UA".into()),
            private,
            startup: true,
            ..Default::default()
        }
    }

    fn pick(token: &str, choice: usize, store: Option<&str>) -> VideoPick {
        VideoPick {
            token: token.into(),
            choice,
            store_id: store.map(str::to_owned),
        }
    }

    /// The look-up's thread, as yt-dlp answers it.
    fn answered(job: &Job, json: &str) {
        let v = mdm_tools::resolve::parse_looked(json.as_bytes()).unwrap();
        *lock(&job.found) = Found::of(Ok(v), false);
    }

    #[test]
    fn each_look_up_keeps_its_own_context() {
        let mut l = Lookups::default();
        let now = Instant::now();
        let a = l
            .begin(
                &look(
                    SRC,
                    Some(" A talk: in Lisbon "),
                    Some("firefox-container-1"),
                ),
                &sent(false, "a=1"),
                now,
            )
            .unwrap();
        let b = l
            .begin(&look(PAGE, None, None), &sent(false, "b=2"), now)
            .unwrap();
        assert_ne!(a.token, b.token);
        assert_eq!(a.token.len(), 64);
        // yt-dlp asks with each one's own.
        assert_eq!(
            (a.address.as_str(), a.browser.cookies.as_deref()),
            (SRC, Some("a=1"))
        );
        assert_eq!(
            (b.address.as_str(), b.browser.cookies.as_deref()),
            (PAGE, Some("b=2"))
        );
        assert_eq!(a.browser.referer.as_deref(), Some(PAGE));
        assert_eq!(l.poll(&a.token, now), VideoLookupAnswer::pending(&a.token));
        answered(&a, STREAM);
        let ready = l.poll(&a.token, now);
        assert_eq!(ready.state, lookup::READY);
        assert_eq!(ready.token.as_deref(), Some(a.token.as_str()));
        assert_eq!(
            ready.title.as_deref(),
            Some("A talk: in Lisbon"),
            "the page's, not yt-dlp's `master`"
        );
        assert_eq!(ready.choices.len(), 2);
        assert!(
            ready.choices[0].label.contains("720p"),
            "{:?}",
            ready.choices
        );
        assert_eq!(ready.choices[0].ext, "mp4");
        assert_eq!(ready.choices[0].size, Some(60 * 2500 * 125), "estimated");
        assert_eq!(l.poll(&b.token, now).state, lookup::PENDING, "its own");
        // The choice takes the look-up's context and MDM's selector for that place.
        let p = l
            .pick(&pick(&a.token, 1, Some("firefox-container-1")), false, now)
            .unwrap();
        assert_eq!(p.address, SRC);
        assert_eq!(p.context.cookies.as_deref(), Some("a=1"));
        assert_eq!(p.context.referer.as_deref(), Some(PAGE));
        assert_eq!(p.context.user_agent.as_deref(), Some("UA"));
        assert_eq!(p.context.video_title.as_deref(), Some("A talk: in Lisbon"));
        assert!(!p.context.private && !p.context.startup);
        assert_eq!(p.choice.selector, "b[height=360]");
        // Once.
        assert!(
            l.pick(&pick(&a.token, 1, Some("firefox-container-1")), false, now)
                .is_none()
        );
        assert_eq!(l.poll(&a.token, now).state, lookup::GONE);
        assert_eq!(l.poll("nonsense", now).state, lookup::GONE);
    }

    /// A private window's look-up is taken from a private window only, and from the same
    /// cookie store; a normal one from a normal window only.
    #[test]
    fn a_private_windows_look_up_is_its_own() {
        let mut l = Lookups::default();
        let now = Instant::now();
        let private = l
            .begin(
                &look(PAGE, None, Some("firefox-private")),
                &sent(true, "p=1"),
                now,
            )
            .unwrap();
        let normal = l
            .begin(&look(PAGE, None, None), &sent(false, "n=1"), now)
            .unwrap();
        answered(&private, STREAM);
        answered(&normal, STREAM);
        let t = private.token.clone();
        assert!(
            l.pick(&pick(&t, 0, Some("firefox-private")), false, now)
                .is_none()
        );
        assert!(l.pick(&pick(&t, 0, None), true, now).is_none());
        assert!(
            l.pick(&pick(&t, 0, Some("firefox-default")), true, now)
                .is_none()
        );
        assert!(l.pick(&pick(&normal.token, 0, None), true, now).is_none());
        assert!(
            l.pick(&pick(&normal.token, 0, Some("firefox-private")), false, now)
                .is_none()
        );
        // The refusals forgot nothing.
        let p = l
            .pick(&pick(&t, 0, Some("firefox-private")), true, now)
            .unwrap();
        assert!(p.context.private);
        assert_eq!(p.context.cookies.as_deref(), Some("p=1"));
        // A blank store is none.
        assert!(
            l.pick(&pick(&normal.token, 0, Some(" ")), false, now)
                .is_some()
        );
    }

    /// The menu looks up what the Download video window would: Dailymotion's embedded player is
    /// the video's own page (#359), downloaded from there too.
    #[test]
    fn the_menu_looks_up_what_the_window_would() {
        let mut l = Lookups::default();
        let now = Instant::now();
        let player = "https://geo.dailymotion.com/player/x19jsm.html?video=k4lGbCpdJJFSQgMvE8W";
        let own = "https://www.dailymotion.com/video/k4lGbCpdJJFSQgMvE8W";
        let job = l
            .begin(&look(player, None, None), &sent(false, ""), now)
            .unwrap();
        assert_eq!(job.address, own);
        answered(&job, STREAM);
        let p = l.pick(&pick(&job.token, 0, None), false, now).unwrap();
        assert_eq!(
            (p.address.as_str(), p.context.video_page.as_deref()),
            (own, Some(own))
        );
    }

    /// Two yt-dlp look-ups at a time: the third is `busy` until one of them ends, its place given
    /// back whatever happens to its token.
    #[test]
    fn two_look_ups_at_a_time() {
        let mut l = Lookups::default();
        let now = Instant::now();
        let a = l
            .begin(&look(PAGE, None, None), &sent(false, ""), now)
            .unwrap();
        let b = l
            .begin(&look(PAGE, None, None), &sent(false, ""), now)
            .unwrap();
        assert!(
            l.begin(&look(PAGE, None, None), &sent(false, ""), now)
                .is_none(),
            "busy"
        );
        // One ends on its own thread.
        let Job { running, .. } = a;
        std::thread::spawn(move || drop(running)).join().unwrap();
        let c = l
            .begin(&look(PAGE, None, None), &sent(false, ""), now)
            .unwrap();
        assert!(
            l.begin(&look(PAGE, None, None), &sent(false, ""), now)
                .is_none()
        );
        // Forgotten tokens' threads still give their places back.
        let later = now + TTL;
        assert_eq!(l.poll(&b.token, later).state, lookup::GONE);
        drop(b);
        drop(c);
        assert!(
            l.begin(&look(PAGE, None, None), &sent(false, ""), later)
                .is_some()
        );
        assert_eq!(l.running.load(Ordering::SeqCst), 0, "dropped at once here");
    }

    /// Ten minutes, or twenty newer look-ups, and a token is gone.
    #[test]
    fn tokens_are_forgotten() {
        let mut l = Lookups::default();
        let now = Instant::now();
        let first = l
            .begin(&look(PAGE, None, None), &sent(false, ""), now)
            .unwrap()
            .token;
        assert_eq!(
            l.poll(&first, now + TTL - Duration::from_secs(1)).state,
            lookup::PENDING
        );
        assert_eq!(l.poll(&first, now + TTL).state, lookup::GONE);
        let tokens: Vec<String> = (0..=KEPT as u64)
            .map(|i| {
                l.begin(
                    &look(PAGE, None, None),
                    &sent(false, ""),
                    now + Duration::from_millis(i),
                )
                .unwrap()
                .token
            })
            .collect();
        let at = now + Duration::from_secs(1);
        assert_eq!(l.poll(&tokens[0], at).state, lookup::GONE, "the oldest");
        assert_eq!(l.poll(&tokens[KEPT], at).state, lookup::PENDING);
        assert_eq!(l.poll(&tokens[1], at).state, lookup::PENDING);
        assert_eq!(l.searches.len(), KEPT);
    }

    /// The browser never names a selector: only a place among the choices offered, while they
    /// are the ones offered.
    #[test]
    fn a_choice_must_be_one_offered() {
        let mut l = Lookups::default();
        let now = Instant::now();
        let job = l
            .begin(&look(SRC, None, None), &sent(false, ""), now)
            .unwrap();
        let t = job.token.clone();
        assert!(
            l.pick(&pick(&t, 0, None), false, now).is_none(),
            "still looking"
        );
        answered(&job, STREAM);
        assert!(
            l.pick(&pick(&t, 2, None), false, now).is_none(),
            "out of range"
        );
        assert!(l.pick(&pick(&t, usize::MAX, None), false, now).is_none());
        assert!(l.pick(&pick("other", 0, None), false, now).is_none());
        assert!(
            l.pick(&pick(&t, 0, None), false, now + TTL).is_none(),
            "forgotten"
        );
        let job = l
            .begin(&look(SRC, None, None), &sent(false, ""), now)
            .unwrap();
        *lock(&job.found) = Found::List;
        assert!(l.pick(&pick(&job.token, 0, None), false, now).is_none());
        *lock(&job.found) = Found::Failed("yt-dlp failed".into());
        assert!(l.pick(&pick(&job.token, 0, None), false, now).is_none());
    }

    /// What isn't a video to choose from is said: a list, nothing to download, yt-dlp's error
    /// (in MDM's words when it has some).
    #[test]
    fn lists_and_failures_are_said() {
        let mut l = Lookups::default();
        let now = Instant::now();
        let job = l
            .begin(&look(PAGE, None, None), &sent(false, ""), now)
            .unwrap();
        answered(
            &job,
            r#"{"_type": "playlist", "title": "Talks", "playlist_count": 12}"#,
        );
        assert_eq!(l.poll(&job.token, now), VideoLookupAnswer::of(lookup::LIST));
        answered(
            &job,
            r#"{"title": "Slides", "formats": [{"format_id": "0", "ext": "jpg", "vcodec": "none", "acodec": "none"}]}"#,
        );
        assert_eq!(
            l.poll(&job.token, now),
            VideoLookupAnswer::failed(lookup::NO_CHOICES, None)
        );
        *lock(&job.found) = Found::Failed("yt-dlp failed: Video unavailable".into());
        let failed = l.poll(&job.token, now);
        assert_eq!(
            (failed.state.as_str(), failed.reason.as_deref()),
            (lookup::FAILED, Some(lookup::ERROR))
        );
        assert_eq!(
            failed.message.as_deref(),
            Some("yt-dlp failed: Video unavailable")
        );
        *lock(&job.found) = Found::Failed("x".repeat(10_000));
        assert_eq!(
            l.poll(&job.token, now).message.unwrap().chars().count(),
            MESSAGE_MAX
        );
        assert!(matches!(Found::of(Err("e".into()), true), Found::Failed(_)));
    }

    /// The choice is added with MDM's selector for it, named after the page that played it,
    /// with the subtitles the window would preselect; started, or queued when Options say so.
    #[test]
    fn the_choice_is_added_as_the_window_would() {
        let mut l = Lookups::default();
        let now = Instant::now();
        let folder = PathBuf::from("downloads").join("Video");
        let de = Subs {
            langs: vec!["de".into()],
            automatic: false,
            embed: false,
        };
        let job = l
            .begin(
                &look(SRC, Some("A talk: in Lisbon"), None),
                &sent(false, "a=1"),
                now,
            )
            .unwrap();
        answered(&job, STREAM);
        let p = l.pick(&pick(&job.token, 0, None), false, now).unwrap();
        drop(job);
        let add = video_add(p, &folder, true, &de).unwrap();
        assert_eq!(add.page.as_str(), SRC);
        assert_eq!(
            add.selector, "b[height=720]",
            "MDM's own, never the browser's"
        );
        assert_eq!(add.dest, folder.join("A talk_ in Lisbon.mp4"));
        assert_eq!(add.size, Some(60 * 2500 * 125));
        assert!(add.start_now);
        assert_eq!(add.context.cookies.as_deref(), Some("a=1"));
        assert_eq!(
            add.subs.langs,
            ["de"],
            "the last video's choice, on this page too"
        );
        assert!(add.remember.is_none(), "the remembered choice stays");
        // No page title (a page yt-dlp names itself), Options' "only add to the queue", a
        // language this page doesn't have.
        let job = l
            .begin(&look(SRC, None, None), &sent(false, ""), now)
            .unwrap();
        answered(&job, STREAM);
        let p = l.pick(&pick(&job.token, 1, None), false, now).unwrap();
        drop(job);
        let ja = Subs {
            langs: vec!["ja".into()],
            ..Default::default()
        };
        let add = video_add(p, &folder, false, &ja).unwrap();
        assert_eq!(add.dest, folder.join("master.mp4"));
        assert_eq!(add.selector, "b[height=360]");
        assert!(!add.start_now);
        assert!(add.subs.langs.is_empty());
        // A video yt-dlp titled itself keeps its title, whatever the page's (#345).
        let job = l
            .begin(
                &look(PAGE, Some("The page's title"), None),
                &sent(false, ""),
                now,
            )
            .unwrap();
        answered(&job, &STREAM.replace("\"master\"", "\"Its own title\""));
        assert_eq!(
            l.poll(&job.token, now).title.as_deref(),
            Some("Its own title")
        );
        let p = l.pick(&pick(&job.token, 0, None), false, now).unwrap();
        drop(job);
        let add = video_add(p, &folder, true, &Subs::default()).unwrap();
        assert_eq!(add.dest, folder.join("Its own title.mp4"));
        // Never an address that isn't on the web.
        let job = l
            .begin(&look("file:///C:/v.mp4", None, None), &sent(false, ""), now)
            .unwrap();
        answered(&job, STREAM);
        let p = l.pick(&pick(&job.token, 0, None), false, now).unwrap();
        assert!(video_add(p, &folder, true, &Subs::default()).is_none());
    }
}
