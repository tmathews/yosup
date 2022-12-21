let DAMUS

const BOOTSTRAP_RELAYS = [
	"wss://relay.damus.io",
	//"wss://nostr-relay.wlvs.space",
	//"wss://nostr-pub.wellorder.net"
]

// TODO autogenerate these constants with a bash script
const IMG_EVENT_LIKED = "icon/event-liked.svg";
const IMG_EVENT_LIKE  = "icon/event-like.svg";

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
	const model = new_model()
	DAMUS = model
	model.pubkey = await get_pubkey()
	if (!model.pubkey)
		return

	model.ids = {
		comments:      "comments",
		profiles:      "profiles",
		explore:       "explore",
		refevents:     "refevents",
		account:       "account",
		home:          "home",
		contacts:      "contacts",
		notifications: "notifications",
		unknowns:      "unknowns",
		dms:           "dms",
	}

	const pool = nostrjs.RelayPool(BOOTSTRAP_RELAYS);
	pool.on("open", on_pool_open);
	pool.on("event", on_pool_event);
	pool.on("notice", on_pool_notice);
	pool.on("eose", on_pool_eose);
	pool.on("ok", on_pool_ok);
	model.pool = pool
	
	let err;
	err = await contacts_load(model);
	if (err) {
		window.alert("Unable to load contacts.");
	}
	await model_load_events(model, (ev)=> {
		model_process_event(model, ev);
	});

	log_debug("loaded events", Object.keys(model.all_events).length);
	view_timeline_update(model);
	view_timeline_apply_mode(model, VM_FRIENDS);
	view_show_spinner(true);
	document.addEventListener('visibilitychange', () => {
		update_title(model);
	});
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
	relay.subscribe(model.ids.account, filter_new_initial(model.pk));
}

function on_pool_notice(relay, notice) {
	log_info(`NOTICE(${relay.url}): ${notice}`);
}

// on_pool_eose occurs when all storage from a relay has been sent to the 
// client for a labeled (sub_id) REQ.
async function on_pool_eose(relay, sub_id) {
	log_info(`EOSE(${relay.url}): ${sub_id}`);
	const model = DAMUS;
	const { ids, pool } = model;
	switch (sub_id) {
		case ids.home:
			const events = model_events_arr(model);
			// TODO filter out events to friends of friends
			request_profiles(ids, model, events, relay)
			pool.unsubscribe(ids.home, relay);
			if (!model.inited) {
				model.inited = true;
			}
			view_show_spinner(false);
			break;
		case ids.profiles:
			model.pool.unsubscribe(ids.profiles, relay);
			break;
		case ids.unknown:
			pool.unsubscribe(ids.unknowns, relay);
			break;
		case ids.account:
			model.done_init[relay] = true;
			pool.unsubscribe(ids.account, relay);
			model_subscribe_defaults(model, relay);
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
	model_process_event(model, ev);
}

//function on_eose_profiles(ids, model, relay) {
//	const prefix = difficulty_to_prefix(model.pow);
//	const fofs = Array.from(model.contacts.friend_of_friends);
//	let pow_filter = {kinds: STANDARD_KINDS, limit: 50};
//	if (model.pow > 0)
//		pow_filter.ids = [ prefix ];
//	let explore_filters = [ pow_filter ];
//	if (fofs.length > 0)
//		explore_filters.push({kinds: STANDARD_KINDS, authors: fofs, limit: 50});
//	model.pool.subscribe(ids.explore, explore_filters, relay);
//}

function request_profiles(ids, model, events, relay) {
	const pubkeys = events.reduce((s, ev) => {
		s.add(ev.pubkey);
		for (const tag of ev.tags) {
			if (tag.length >= 2 && tag[0] === "p") {
				if (!model.profile_events[tag[1]])
					s.add(tag[1]);
			}
		}
		return s;
	}, new Set());
	// load profiles and noticed chatrooms
	const authors = Array.from(pubkeys)
	const profile_filter = {
		kinds: [KIND_METADATA, KIND_CONTACT], 
		authors: authors
	};
	let filters = [];
	if (authors.length > 0)
		filters.push(profile_filter);
	if (filters.length === 0) {
		//log_debug("No profiles filters to request...")
		return
	}
	//console.log("subscribe", profiles_id, filter, relay)
	//log_debug("subscribing to profiles on %s", relay.url)
	model.pool.subscribe(ids.profiles, filters, relay)
}

