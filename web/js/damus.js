let DAMUS

const STANDARD_KINDS = [1, 42, 5, 6, 7];

const BOOTSTRAP_RELAYS = [
	"wss://nostr.rdfriedl.com",
	//"wss://relay.damus.io",
	//"wss://nostr-relay.wlvs.space",
	//"wss://nostr-pub.wellorder.net"
]

const DEFAULT_PROFILE = {
	name: "anon",
	display_name: "Anonymous",
}

async function damus_web_init() {
	init_message_textareas();
	let tries = 0;
	function init() {
		// only wait for 500ms max
		const max_wait = 500
		const interval = 20
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
	const {RelayPool} = nostrjs
	const pool = RelayPool(BOOTSTRAP_RELAYS)
	const ids = {
		comments:      "comments",//uuidv4(),
		profiles:      "profiles",//uuidv4(),
		explore:       "explore",//uuidv4(),
		refevents:     "refevents",//uuidv4(),
		account:       "account",//uuidv4(),
		home:          "home",//uuidv4(),
		contacts:      "contacts",//uuidv4(),
		notifications: "notifications",//uuidv4(),
		unknowns:      "unknowns",//uuidv4(),
		dms:           "dms",//uuidv4(),
	}

	model.ids = ids
	model.pool = pool
	model.view_el = document.querySelector("#view")
	//load_cache(model)

	view_timeline_apply_mode(model, VM_FRIENDS);
	document.addEventListener('visibilitychange', () => {
		update_title(model)
	});
	update_timestamps();	
	pool.on("open", on_pool_open);
	pool.on("event", on_pool_event);
	pool.on("notice", on_pool_notice);
	pool.on("eose", on_pool_eose);
	pool.on("ok", on_pool_ok);
	return pool
}

function update_timestamps() {
	setTimeout(() => {
		update_timestamps();
		view_timeline_update_timestamps();
	}, 60 * 1000);
}

function on_pool_open(relay) {
	log_info("opened relay", relay);
	const model = DAMUS;
	// We check the cache if we have init anything, if not we do our inital
	// otherwise we do a get since last
	if (!model.done_init[relay]) {
		// if we have not init'd the relay simply get our initial filters
		relay.subscribe(model.ids.account, filter_new_initial(model.pk));
	} else {
		// otherwise let's get everythign since the last time
		model_subscribe_defaults(model, relay);
	}
}

function on_pool_notice(relay, notice) {
	log_info("notice", relay.url, notice);
	// DO NOTHING
}

// on_pool_eose occurs when all storage from a relay has been sent to the 
// client.
async function on_pool_eose(relay, sub_id) {
	//console.info("eose", relay.url, sub_id);
	const model = DAMUS;
	const { ids, pool } = model;
	switch (sub_id) {
		case ids.home:
			const events = model_events_arr(model);
			// TODO filter out events to friends of friends
			on_eose_comments(ids, model, events, relay)
			pool.unsubscribe(ids.home, relay);
			break;
		case ids.profiles:
			model.pool.unsubscribe(ids.profiles, relay);
			on_eose_profiles(ids, model, relay)
			break;
		case ids.unknown:
			pool.unsubscribe(ids.unknowns, relay);
			break;
	}
}

function on_pool_ok(relay) {
	console.log("OK", arguments);
}

function on_pool_event(relay, sub_id, ev) {
	const model = DAMUS;
	const { ids, pool } = model;

	// Process event and apply side effects
	if (!model.all_events[ev.id]) {
		model.all_events[ev.id] = ev;
		model_process_event(model, ev);
		// schedule_save_events(model);
	}

	// Update subscriptions
	switch (sub_id) {
		case ids.account:
			model.done_init[relay] = true;
			pool.unsubscribe(ids.account, relay);
			model_subscribe_defaults(model, relay);
			break;
	}
}

function on_eose_profiles(ids, model, relay) {
	const prefix = difficulty_to_prefix(model.pow);
	const fofs = Array.from(model.contacts.friend_of_friends);
	const standard_kinds = [1,42,5,6,7];
	let pow_filter = {kinds: standard_kinds, limit: 50};
	if (model.pow > 0)
		pow_filter.ids = [ prefix ];
	let explore_filters = [ pow_filter ];
	if (fofs.length > 0)
		explore_filters.push({kinds: standard_kinds, authors: fofs, limit: 50});
	model.pool.subscribe(ids.explore, explore_filters, relay);
}

function on_eose_comments(ids, model, events, relay) {
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
	const authors = Array.from(pubkeys)
	// load profiles and noticed chatrooms
	const profile_filter = {kinds: [0,3], authors: authors};
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

