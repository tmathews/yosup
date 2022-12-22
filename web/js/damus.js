let DAMUS

const BOOTSTRAP_RELAYS = [
	"wss://relay.damus.io",
	"wss://nostr-relay.wlvs.space",
	"wss://nostr-pub.wellorder.net",
]

// TODO autogenerate these constants with a bash script
const IMG_EVENT_LIKED = "icon/event-liked.svg";
const IMG_EVENT_LIKE  = "icon/event-like.svg";
const IMG_NO_USER     = "icon/no-user.svg";

const SID_META          = "meta";
const SID_HISTORY       = "history";
const SID_NOTIFICATIONS = "notifications";
const SID_EXPLORE       = "explore";
const SID_PROFILES      = "profiles";

async function damus_web_init() {
	init_message_textareas();
	let tries = 0;
	function init() {
		// only wait for 500ms max
		const max_wait = 500;
		const interval = 20;
		if (window.nostr || tries >= (max_wait/interval)) {
			log_info("init after", tries);
			damus_web_init_ready();
			return;
		}
		tries++;
		setTimeout(init, interval);
	}
	init();
}

async function damus_web_init_ready() {
	const model = new_model();
	DAMUS = model;
	model.pubkey = await get_pubkey();
	if (!model.pubkey) {
		// TODO show welcome screen
		return;
	}

	// WARNING Order Matters!
	view_show_spinner(true);
	document.addEventListener('visibilitychange', () => {
		update_title(model);
	});

	// Load our contacts first
	let err;
	err = await contacts_load(model);
	if (err) {
		window.alert("Unable to load contacts.");
	}

	// Create our pool so that event processing functions can work
	const pool = nostrjs.RelayPool(BOOTSTRAP_RELAYS);
	model.pool = pool
	pool.on("open", on_pool_open);
	pool.on("event", on_pool_event);
	pool.on("notice", on_pool_notice);
	pool.on("eose", on_pool_eose);

	// Load all events from storage and re-process them so that apply correct
	// effects.
	await model_load_events(model, (ev)=> {
		model_process_event(model, undefined, ev);
	});
	log_debug("loaded events", Object.keys(model.all_events).length);

	// Update our view and apply timer methods once all data is ready to go.
	view_timeline_update(model);
	view_timeline_apply_mode(model, VM_FRIENDS);
	on_timer_timestamps();
	on_timer_invalidations();
	on_timer_save();
	on_timer_tick();
	
	return pool;
}

function on_timer_timestamps() {
	setTimeout(() => {
		view_timeline_update_timestamps();
		on_timer_timestamps();
	}, 60 * 1000);
}

function on_timer_invalidations() {
	setTimeout(() => {
		if (DAMUS.invalidated.length > 0)
			view_timeline_update(DAMUS);
		on_timer_invalidations();
	}, 100);
}

function on_timer_save() {
	setTimeout(() => {
		model_save_events(DAMUS);
		contacts_save(DAMUS.contacts);
		on_timer_invalidations();
	}, 10 * 1000);
}

function on_timer_tick() {
	setTimeout(() => {
		DAMUS.relay_que.forEach((que, relay) => {
			model_fetch_next_profile(DAMUS, relay);
		});
		on_timer_tick();
	}, 1 * 1000);
}

/* on_pool_open occurs when a relay is opened. It then subscribes for the
 * relative REQ as needed.
 */
function on_pool_open(relay) {
	log_info(`OPEN(${relay.url})`);
	const model = DAMUS;
	const { pubkey } = model;

	// Get all our info & history, well close this after we get  it
	fetch_profile(pubkey, model.pool, relay);

	// Get our notifications. We will never close this.
	relay.subscribe(SID_NOTIFICATIONS, [{
		kinds: STANDARD_KINDS,
		"#p": [pubkey],
		limit: 5000,
	}]);

	// Get the latest history as a prefetch 
	relay.subscribe(SID_HISTORY, [{
		kinds: STANDARD_KINDS,
		limit: 500,
	}]);

	// TODO perhaps get our following list's history too
}

function on_pool_notice(relay, notice) {
	log_info(`NOTICE(${relay.url}): ${notice}`);
}

// on_pool_eose occurs when all storage from a relay has been sent to the 
// client for a labeled (sub_id) REQ.
async function on_pool_eose(relay, sub_id) {
	log_info(`EOSE(${relay.url}): ${sub_id}`);
	const model = DAMUS;
	const { pool } = model;
	
	const sid = sub_id.slice(0, sub_id.indexOf(":"));
	switch (sid) {
		case SID_PROFILES:
		case SID_META:
		case SID_HISTORY:
			pool.unsubscribe(sub_id, relay);
			break;
	}
}

function on_pool_event(relay, sub_id, ev) {
	const model = DAMUS;

	// Simply ignore any events that happened in the future.
	if (new Date(ev.created_at * 1000) > new Date()) {
		log_debug(`blocked event caust it was newer`, ev);
		return;	
	}
	model_process_event(model, relay, ev);
}

function fetch_profiles(pool, relay, pubkeys) {
	log_debug(`(${relay.url}) fetching '${pubkeys.length} profiles'`);
	pool.subscribe(SID_PROFILES, [{
		kinds: [KIND_METADATA],
		authors: pubkeys,
	}], relay);
}

function fetch_profile_info(pubkey, pool, relay) {
	const sid = `${SID_META}:${pubkey}`;
	pool.subscribe(sid, [{
		kinds: [KIND_METADATA, KIND_CONTACT],
		authors: [pubkey],
		limit: 1,
	}], relay);
	return sid;
}

function fetch_profile(pubkey, pool, relay) {
	fetch_profile_info(pubkey, pool, relay);	
	pool.subscribe(`${SID_HISTORY}:${pubkey}`, [{
		kinds: STANDARD_KINDS,
		authors: [pubkey],
		limit: 1000,
	}], relay);
}

function subscribe_explore(limit) {
	DAMUS.pool.subscribe(SID_EXPLORE, [{
		kinds: STANDARD_KINDS,
		limit: limit,
	}]);
}

function unsubscribe_explore() {
	DAMUS.pool.unsubscribe(SID_EXPLORE);
}
