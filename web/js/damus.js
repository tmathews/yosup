let DAMUS

const BOOTSTRAP_RELAYS = [
	"wss://relay.damus.io",
	"wss://nostr-relay.wlvs.space",
	"wss://nostr-pub.wellorder.net",
]

// TODO autogenerate these constants with a bash script
const IMG_EVENT_LIKED = "icon/event-liked.svg";
const IMG_EVENT_LIKE  = "icon/event-like.svg";

const SID_META = "meta";
const SID_HISTORY = "history";
const SID_NOTIFICATIONS = "notifications";
const SID_EXPLORE = "explore";

async function damus_web_init() {
	init_message_textareas();
	let tries = 0;
	function init() {
		// only wait for 500ms max
		const max_wait = 500;
		const interval = 20;
		if (window.nostr || tries >= (max_wait/interval)) {
			console.info("init after", tries);
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
	pool.on("ok", on_pool_ok);

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
	}, 1 * 1000);
}

function on_timer_save() {
	setTimeout(() => {
		model_save_events(DAMUS);
		contacts_save(DAMUS.contacts);
		on_timer_invalidations();
	}, 10 * 1000);
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

	// Subscribe to the relay's world. We will also never close this.
	relay.subscribe(SID_EXPLORE, [{
		kinds: STANDARD_KINDS,
		limit: 10000, // TODO this is a lot to handle and we should deal with it another way
	}]);
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
	switch (sub_id) {
		case SID_META:
			model_get_relay_que(model, relay).busy = false;
			model_fetch_next_profile(model, relay);
		case SID_HISTORY:
			pool.unsubscribe(sub_id, relay);
			break;
	}
}

function on_pool_ok(relay) {
	log_info(`OK(${relay.url})`, arguments);
}

function on_pool_event(relay, sub_id, ev) {
	const model = DAMUS;

	// Simply ignore any events that happened in the future.
	if (new Date(ev.created_at * 1000) > new Date()) {
		return;	
	}
	model_process_event(model, relay, ev);
}

function fetch_profile_info(pubkey, pool, relay) {
	pool.subscribe(`${SID_META}:${pubkey}`, [{
		kinds: [KIND_METADATA, KIND_CONTACT],
		authors: [pubkey],
		limit: 1,
	}], relay);
}

function fetch_profile(pubkey, pool, relay) {
	fetch_profile_info(pubkey, pool, relay);	
	pool.subscribe(`${SID_HISTORY}:${pubkey}`, [{
		kinds: STANDARD_KINDS,
		authors: [pubkey],
		limit: 1000,
	}], relay);
}

/*
function new_sub_id(prefix) {
	return `${prefix}:${uuidv4()}`;
}

let request_profiles_timer;
function request_profiles() {
	if (request_profiles_timer)
		clearTimeout(request_profiles_timer);
	request_profiles_timer = setTimeout(()=>{
		if (fetch_queued_profiles(DAMUS))
			request_profiles();
	}, 200);
}

function fetch_queued_profiles(model) {
	const delayed = [];
	const m = new Map();
	for(let i = 0; model.requested_profiles.length > 0 && i < 300; i++) {
		let r = model.requested_profiles.pop();
		let s;
		if (!m.has(r.relay)) {
			s = new Set();
			m.set(r.relay, s);
		} else {
			s = m.get(r.relay);
		}
		if (s.size >= 50) {
			delayed.push(r);	
			continue;
		}
		s.add(r.pubkey);
	}
	model.requested_profiles = model.requested_profiles.concat(delayed);
	//log_debug(`m size ${m.size}`);
	m.forEach((set, relay) => {
		let filters = [{
			kinds: [KIND_METADATA, KIND_CONTACT],
			authors: Array.from(set),
		}];
		let sid = new_sub_id(SID_PROFILES);
		model.pool.subscribe(sid, filters, relay);
		log_debug(`(${relay.url}) fetching profiles ${sid} size(${set.size})`);
	})
	return model.requested_profiles.length > 0;
}*/


