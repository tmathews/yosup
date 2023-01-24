let DAMUS = new_model();

// TODO autogenerate these constants with a bash script
const IMG_EVENT_LIKED = "icon/event-liked.svg";
const IMG_EVENT_LIKE  = "icon/event-like.svg";
const IMG_NO_USER     = "icon/no-user.svg";

const SID_META          = "meta";
const SID_HISTORY       = "history";
const SID_NOTIFICATIONS = "notifications";
const SID_DMS_OUT       = "dms_out";
const SID_DMS_IN        = "dms_in";
const SID_EXPLORE       = "explore";
const SID_PROFILES      = "profiles";
const SID_THREAD        = "thread";
const SID_FRIENDS       = "friends";

// This is our main entry.
// https://developer.mozilla.org/en-US/docs/Web/API/Window/DOMContentLoaded_event
addEventListener('DOMContentLoaded', (ev) => {
	damus_web_init();
	document.addEventListener("click", onclick_any);
});

async function damus_web_init() {
	let tries = 0;
	const max_wait = 500;
	const interval = 20;
	async function init() {
		if (window.nostr || tries >= (max_wait/interval)) {
			log_info("init after", tries);
			await damus_web_init_ready();
			return;
		}
		tries++;
		await init();
	}
	setTimeout(init, interval);
}

async function damus_web_init_ready() {
	const model = DAMUS;
	model.pubkey = await get_pubkey(false);

	find_node("#container-busy").classList.add("hide");
	if (!model.pubkey) {
		find_node("#container-welcome").classList.remove("hide");
		return;
	}
	find_node("#container-app").classList.remove("hide");
	webapp_init();
}

async function signin() {
	const model = DAMUS;
	try {
		model.pubkey = await get_pubkey();
	} catch (err) {
		window.alert("An error occured trying to get your public key.");
		return;
	}
	if (!model.pubkey) {
		window.alert("No public key was aquired.");
		return;
	}
	find_node("#container-welcome").classList.add("hide");
	find_node("#container-app").classList.remove("hide");
	await webapp_init();
}

async function webapp_init() {
	const model = DAMUS;

	// WARNING Order Matters!
	init_message_textareas();
	init_timeline(model);
	init_my_pfp(model);
	init_postbox(model);
	init_profile();
	view_show_spinner(true);

	// Load data from storage 
	await model_load_settings(model);
	let err;
	err = await contacts_load(model);
	if (err) {
		window.alert("Unable to load contacts.");
	}
	init_settings(model);

	// Create our pool so that event processing functions can work
	const pool = nostrjs.RelayPool(model.relays);
	model.pool = pool
	pool.on("open", on_pool_open);
	pool.on("event", on_pool_event);
	pool.on("notice", on_pool_notice);
	pool.on("eose", on_pool_eose);
	pool.on("ok", on_pool_ok);

	// Load all events from storage and re-process them so that apply correct
	// effects.
	/*await model_load_events(model, (ev)=> {
		model_process_event(model, undefined, ev);
	});
	log_debug("loaded events", Object.keys(model.all_events).length);

	// Update our view and apply timer methods once all data is ready to go.
	view_timeline_update(model);*/
	view_timeline_apply_mode(model, VM_FRIENDS, {hide_replys: true});
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
	const model = DAMUS;
	setTimeout(async () => {
		if (model.dms_need_redraw && view_get_timeline_el().dataset.mode == VM_DM) {
			// if needs decryption do it
			await decrypt_dms(model);
			view_dm_update(model);
			model.dms_need_redraw = false;
		}
		if (model.invalidated.length > 0)
			view_timeline_update(model);
		on_timer_invalidations();
	}, 50);
}

function on_timer_save() {
	setTimeout(() => {
		const model = DAMUS;
		//model_save_events(model);
		model_save_settings(model);
		on_timer_save();
	}, 1 * 1000);
}

function on_timer_tick() {
	const model = DAMUS;
	setTimeout(async () => {
		update_notifications(model);
		model.relay_que.forEach((que, relay) => {
			model_fetch_next_profile(model, relay);
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

	// Get our notifications
	relay.subscribe(SID_NOTIFICATIONS, [{
		kinds: STANDARD_KINDS,
		"#p": [pubkey],
		limit: 5000,
	}]);

	// Get our dms. You have to do 2 separate queries: ours out and others in
	relay.subscribe(SID_DMS_IN, [{
		kinds: [KIND_DM],
		"#p": [pubkey],
	}]);
	relay.subscribe(SID_DMS_OUT, [{
		kinds: [KIND_DM],
		authors: [pubkey],
	}]);

	// Subscribe to the world as it will serve our friends, notifications, and 
	// explore views
	relay.subscribe(SID_EXPLORE, [{
		kinds: STANDARD_KINDS,
		limit: 500,
	}]);

	// Grab our friends history so our default timeline looks loaded 
	if (model.contacts.friends.size > 0) {
		model_get_relay_que(model, relay).contacts_init = true;
		fetch_friends_history(Array.from(model.contacts.friends), model.pool, relay);
	}
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
	const index = sub_id.indexOf(":");
	const sid = sub_id.slice(0, index >= 0 ? index : sub_id.length);
	const identifier = sub_id.slice(index+1);
	switch (sid) {
		case SID_HISTORY:
		case SID_THREAD:
		case SID_FRIENDS:
			view_timeline_refresh(model); 
			pool.unsubscribe(sub_id, relay);
			break
		case SID_META:
			// if sid is ours and we did not init properly (must be login) then 
			// we will fetch our friends history now
			if (model.pubkey == identifier && 
				!model_get_relay_que(model, relay).contacts_init) {
				fetch_friends_history(Array.from(model.contacts.friends), 
					pool, relay);
				log_debug("Got our friends after no init & fetching our friends");
			}
		case SID_NOTIFICATIONS:
		case SID_PROFILES:
		case SID_DMS_OUT:
		case SID_DMS_IN:
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

function on_pool_ok(relay, evid, status) {
	log_debug(`OK(${relay.url}): ${evid} = '${status}'`);
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
		kinds: [KIND_METADATA, KIND_CONTACT, KIND_RELAY],
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

function fetch_thread_history(evid, pool) {
	const sid = `${SID_THREAD}:${evid}`
	pool.subscribe(sid, [{
		kinds: STANDARD_KINDS,
		limit: 1000,
		"#e": [evid],
	}]);
	log_debug(`fetching thread ${sid}`);
}

function fetch_friends_history(friends, pool, relay) {
	pool.subscribe(SID_FRIENDS, [{
		kinds: STANDARD_KINDS,
		authors: friends,
		limit: 500,
	}], relay);
}
