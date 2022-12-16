let DAMUS

const STANDARD_KINDS = [1, 42, 5, 6, 7];

const BOOTSTRAP_RELAYS = [
	"wss://relay.damus.io",
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

	switch_view('home')
	document.addEventListener('visibilitychange', () => {
		update_title(model)
	})
	pool.on("open", on_pool_open);
	pool.on("event", on_pool_event);
	pool.on("notice", on_pool_notice);
	pool.on("eose", on_pool_eose);
	return pool
}

function on_pool_open(relay) {
	console.info("opened relay", relay);
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
	console.info("notice", notice);
	// DO NOTHING
}

// TODO document what EOSE is
async function on_pool_eose(relay, sub_id) {
	console.info("eose", relay.url, sub_id);
	const model = DAMUS;
	const { ids, pool } = model;
	switch (sub_id) {
		case ids.home:
			//const events = model.views.home.events
			//handle_comments_loaded(ids, model, events, relay)
			break;
		case ids.profiles:
			//const view = get_current_view()
			//handle_profiles_loaded(ids, model, view, relay)
			break;
		case ids.unknown:
			// TODO document why we unsub from unknowns
			pool.unsubscribe(ids.unknowns, relay);
			break;
	}
}

function on_pool_event(relay, sub_id, ev) {
	console.info("event", relay.url, sub_id, ev);
	const model = DAMUS;
	const { ids, pool } = model;
	
	if (!model.all_events[ev.id]) {
		model.all_events[ev.id] = ev;
		model_process_event(model, ev);
		// schedule_save_events(model);
	}

	switch (sub_id) {
		case ids.account:
			model.done_init[relay] = true;
			pool.unsubscribe(ids.account, relay);
			model_subscribe_defaults(model, relay);
			break;
	}

	// TODO do smart view update logic here
}

