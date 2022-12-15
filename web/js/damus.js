let DAMUS

const BOOTSTRAP_RELAYS = [
	"wss://relay.damus.io",
	"wss://nostr-relay.wlvs.space",
	"wss://nostr-pub.wellorder.net"
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
	const model = init_home_model()
	DAMUS = model
	model.pubkey = await get_pubkey()
	if (!model.pubkey)
		return
	const {RelayPool} = nostrjs
	const pool = RelayPool(BOOTSTRAP_RELAYS)
	const now = new_creation_time()
	const ids = {
		comments: "comments",//uuidv4(),
		profiles: "profiles",//uuidv4(),
		explore: "explore",//uuidv4(),
		refevents: "refevents",//uuidv4(),
		account: "account",//uuidv4(),
		home: "home",//uuidv4(),
		contacts: "contacts",//uuidv4(),
		notifications: "notifications",//uuidv4(),
		unknowns: "unknowns",//uuidv4(),
		dms: "dms",//uuidv4(),
	}

	model.ids = ids
	model.pool = pool
	load_cache(model)
	model.view_el = document.querySelector("#view")

	switch_view('home')
	document.addEventListener('visibilitychange', () => {
		update_title(model)
	})
	
	pool.on('open', (relay) => {
		//let authors = followers
		// TODO: fetch contact list
		log_debug("relay connected", relay.url)
		if (!model.done_init[relay]) {
			send_initial_filters(ids.account, model.pubkey, relay)
		} else {
			send_home_filters(model, relay)
		}
		//relay.subscribe(comments_id, {kinds: [1,42], limit: 100})
	});
	pool.on('event', (relay, sub_id, ev) => {
		handle_home_event(model, relay, sub_id, ev)
	})
	pool.on('notice', (relay, notice) => {
		log_debug("NOTICE", relay, notice)
	})
	pool.on('eose', async (relay, sub_id) => {
		if (sub_id === ids.home) {
			//log_debug("got home EOSE from %s", relay.url)
			const events = model.views.home.events
			handle_comments_loaded(ids, model, events, relay)
		} else if (sub_id === ids.profiles) {
			//log_debug("got profiles EOSE from %s", relay.url)
			const view = get_current_view()
			handle_profiles_loaded(ids, model, view, relay)
		} else if (sub_id === ids.unknowns) {
			model.pool.unsubscribe(ids.unknowns, relay)
		}
	})
	return pool
}

function insert_event_sorted(evs, new_ev) {
	for (let i = 0; i < evs.length; i++) {
		 const ev = evs[i]
		 if (new_ev.id === ev.id) {
		         return false
		 }
		 if (new_ev.created_at > ev.created_at) {
		         evs.splice(i, 0, new_ev)
		         return true
		 }
	}
	evs.push(new_ev)
	return true
}

function init_contacts() {
	return {
		event: null,
		friends: new Set(),
		friend_of_friends: new Set(),
	}
}

function init_timeline(name) {
	return {
		name,
		events: [],
		rendered: new Set(),
		depths: {},
		expanded: new Set(),
	}
}

function init_home_model() {
	return {
		done_init: {},
		notifications: 0,
		max_depth: 2,
		all_events: {},
		reactions_to: {},
		chatrooms: {},
		unknown_ids: {},
		unknown_pks: {},
		deletions: {},
		but_wait_theres_more: 0,
		cw_open: {},
		views: {
			home: init_timeline('home'),
			explore: {
				...init_timeline('explore'),
				seen: new Set(),
			},
			notifications: {
				...init_timeline('notifications'),
				max_depth: 1,
			},
			profile: init_timeline('profile'),
			thread: init_timeline('thread'),
		},
		pow: 0, // pow difficulty target
		deleted: {},
		profiles: {},
		profile_events: {},
		last_event_of_kind: {},
		contacts: init_contacts()
	}
}

function notice_chatroom(state, id) {
	if (!state.chatrooms[id])
		state.chatrooms[id] = {}
}

function process_reaction_event(model, ev) {
	if (!is_valid_reaction_content(ev.content))
		return
	let last = {}
	for (const tag of ev.tags) {
		if (tag.length >= 2 && (tag[0] === "e" || tag[0] === "p"))
			last[tag[0]] = tag[1]
	}
	if (last.e) {
		model.reactions_to[last.e] = model.reactions_to[last.e] || new Set()
		model.reactions_to[last.e].add(ev.id)
	}
}

function process_chatroom_event(model, ev) {
	model.chatrooms[ev.id] = safe_parse_json(ev.content, 
		"chatroom create event");
}

function process_contact_event(model, ev) {
	load_our_contacts(model.contacts, model.pubkey, ev)
	load_our_relays(model.pubkey, model.pool, ev)
	add_contact_if_friend(model.contacts, ev)
}

function process_json_content(ev) {
	ev.json_content = safe_parse_json(ev.content, "event json_content");
}

function process_deletion_event(model, ev) {
	for (const tag of ev.tags) {
		if (tag.length >= 2 && tag[0] === "e") {
			const evid = tag[1]
			// we've already recorded this one as a valid deleted
			// event we can just ignore it
			if (model.deleted[evid])
				continue
			let ds = model.deletions[evid] =
				(model.deletions[evid] || new Set())
			// add the deletion event id to the deletion set of
			// this event we will use this to determine if this
			// event is valid later in case we don't have the
			// deleted event yet.
			ds.add(ev.id)
		}
	}
}

// TODO rename is_deleted to is_event_deleted
function is_deleted(model, evid) {
	// we've already know it's deleted
	if (model.deleted[evid])
		return model.deleted[evid]

	const ev = model.all_events[evid]
	if (!ev)
		return false

	// all deletion events
	const ds = model.deletions[ev.id]
	if (!ds)
		return false

	// find valid deletion events
	for (const id of ds.keys()) {
		const d_ev = model.all_events[id]
		if (!d_ev)
			continue

		// only allow deletes from the user who created it
		if (d_ev.pubkey === ev.pubkey) {
			model.deleted[ev.id] = d_ev
			log_debug("received deletion for", ev)
			// clean up deletion data that we don't need anymore
			delete model.deletions[ev.id]
			return true
		} else {
			log_debug(`User ${d_ev.pubkey} tried to delete ${ev.pubkey}'s event ... what?`)
		}
	}
	return false
}

function has_profile(damus, pk) {
	return pk in damus.profiles
}

function has_event(damus, evid) {
	return evid in damus.all_events
}

function make_unk(hint, ev) {
	const attempts = 0
	const parent_created = ev.created_at
	if (hint && hint !== "")
		return {attempts, hint: hint.trim().toLowerCase(), parent_created}
	return {attempts, parent_created}
}

function notice_unknown_ids(damus, ev) {
	// make sure this event itself is removed from unknowns
	if (ev.kind === 0)
		delete damus.unknown_pks[ev.pubkey]
	delete damus.unknown_ids[ev.id]

	let got_some = false

	for (const tag of ev.tags) {
		if (tag.length >= 2) {
			if (tag[0] === "p") {
				const pk = tag[1]
				if (!has_profile(damus, pk) && is_valid_id(pk)) {
					got_some = true
					damus.unknown_pks[pk] = make_unk(tag[2], ev)
				}
			} else if (tag[0] === "e") {
				const evid = tag[1]
				if (!has_event(damus, evid) && is_valid_id(evid)) {
					got_some = true
					damus.unknown_ids[evid] = make_unk(tag[2], ev)
				}
			}
		}
	}

	return got_some
}

function gather_unknown_hints(damus, pks, evids)
{
	let relays = new Set()
	for (const pk of pks) {
		const unk = damus.unknown_pks[pk]
		if (unk && unk.hint && unk.hint !== "")
			relays.add(unk.hint)
	}
	for (const evid of evids) {
		const unk = damus.unknown_ids[evid]
		if (unk && unk.hint && unk.hint !== "")
			relays.add(unk.hint)
	}
	return Array.from(relays)
}

function get_non_expired_unknowns(unks, type)
{
	const MAX_ATTEMPTS = 2

	function sort_parent_created(a_id, b_id) {
		const a = unks[a_id]
		const b = unks[b_id]
		return b.parent_created - a.parent_created
	}

	let new_expired = 0
	const ids = Object.keys(unks).sort(sort_parent_created).reduce((ids, unk_id) => {
		if (ids.length >= 255)
			return ids

		const unk = unks[unk_id]
		if (unk.attempts >= MAX_ATTEMPTS) {
			if (!unk.expired) {
				unk.expired = true
				new_expired++
			}
			return ids
		}

		unk.attempts++

		ids.push(unk_id)
		return ids
	}, [])

	if (new_expired !== 0)
		log_debug("Gave up looking for %d %s", new_expired, type)

	return ids
}

function fetch_unknown_events(damus)
{
	let filters = []

	const pks = get_non_expired_unknowns(damus.unknown_pks, 'profiles')
	const evids = get_non_expired_unknowns(damus.unknown_ids, 'events')
	const relays = gather_unknown_hints(damus, pks, evids)
	for (const relay of relays) {
		if (!damus.pool.has(relay)) {
			log_debug("adding %s to relays to fetch unknown events", relay)
			damus.pool.add(relay)
		}
	}
	if (evids.length !== 0) {
		const unk_kinds = [1,5,6,7,40,42]
		filters.push({ids: evids, kinds: unk_kinds})
		filters.push({"#e": evids, kinds: [1,42], limit: 100})
	}
	if (pks.length !== 0)
		filters.push({authors: pks, kinds:[0]})
	if (filters.length === 0)
		return
	log_debug("fetching unknowns", filters)
	damus.pool.subscribe('unknowns', filters)
}

function schedule_unknown_refetch(damus)
{
	const INTERVAL = 5000
	if (!damus.unknown_timer) {
		log_debug("fetching unknown events now and in %d seconds", INTERVAL / 1000)

		damus.unknown_timer = setTimeout(() => {
			fetch_unknown_events(damus)

			setTimeout(() => {
				delete damus.unknown_timer
				if (damus.but_wait_theres_more > 0) {
					damus.but_wait_theres_more = 0
					schedule_unknown_refetch(damus)
				}
			}, INTERVAL)
		}, INTERVAL)

		fetch_unknown_events(damus)
	} else {
		damus.but_wait_theres_more++
	}
}

function process_event(damus, ev)
{
	ev.refs = determine_event_refs(ev.tags)
	const notified = was_pubkey_notified(damus.pubkey, ev)
	ev.notified = notified

	const got_some_unknowns = notice_unknown_ids(damus, ev)
	if (got_some_unknowns)
		schedule_unknown_refetch(damus)

	ev.pow = calculate_pow(ev)

	if (ev.kind === 7)
		process_reaction_event(damus, ev)
	else if (ev.kind === 42 && ev.refs && ev.refs.root)
		notice_chatroom(damus, ev.refs.root)
	else if (ev.kind === 40)
		process_chatroom_event(damus, ev)
	else if (ev.kind === 5)
		process_deletion_event(damus, ev)
	else if (ev.kind === 0)
		process_profile_event(damus, ev)
	else if (ev.kind === 3)
		process_contact_event(damus, ev)

	const last_notified = get_local_state('last_notified_date')
	if (notified && (last_notified == null || ((ev.created_at*1000) > last_notified))) {
		set_local_state('last_notified_date', new Date().getTime())
		damus.notifications++
		update_title(damus)
	}
}

function was_pubkey_notified(pubkey, ev)
{
	if (!(ev.kind === 1 || ev.kind === 42))
		return false

	if (ev.pubkey === pubkey)
		return false

	for (const tag of ev.tags) {
		if (tag.length >= 2 && tag[0] === "p" && tag[1] === pubkey)
			return true
	}

	return false
}

function should_add_to_notification_timeline(our_pk, contacts, ev, pow)
{
	if (!should_add_to_timeline(ev))
		return false

	// TODO: add items that don't pass spam filter to "message requests"
	// Then we will need a way to whitelist people as an alternative to
	// following them
	return passes_spam_filter(contacts, ev, pow)
}

function should_add_to_explore_timeline(contacts, view, ev, pow)
{
	if (!should_add_to_timeline(ev))
		return false

	if (view.seen.has(ev.pubkey))
		return false

	// hide friends for 0-pow situations
	if (pow === 0 && contacts.friends.has(ev.pubkey))
		return false

	return passes_spam_filter(contacts, ev, pow)
}

function handle_redraw_logic(model, view_name)
{
	const view = model.views[view_name]
	if (view.redraw_timer)
		clearTimeout(view.redraw_timer)
	view.redraw_timer = setTimeout(redraw_events.bind(null, model, view), 600)
}

function schedule_save_events(damus)
{
	if (damus.save_timer)
		clearTimeout(damus.save_timer)
	damus.save_timer = setTimeout(save_cache.bind(null, damus), 3000)
}

function calculate_last_of_kind(evs) {
	const now_sec = new Date().getTime() / 1000
	return Object.keys(evs).reduce((obj, evid) => {
		const ev = evs[evid]
		if (!is_valid_time(now_sec, ev.created_at))
			return obj
		const prev = obj[ev.kind] || 0
		obj[ev.kind] = get_since_time(max(ev.created_at, prev))
		return obj
	}, {})
}

function load_our_relays(our_pubkey, pool, ev) {
	if (ev.pubkey != our_pubkey)
		return

	let relays
	try {
		relays = JSON.parse(ev.content)
	} catch (e) {
		log_error("error loading relays", e)
		return
	}

	for (const relay of Object.keys(relays)) {
		if (!pool.has(relay)) {
			log_debug("adding relay", relay)
			pool.add(relay)
		}
	}
}

function load_our_contacts(contacts, our_pubkey, ev) {
	if (ev.pubkey !== our_pubkey)
		return
	contacts.event = ev
	for (const tag of ev.tags) {
		if (tag.length > 1 && tag[0] === "p") {
			contacts.friends.add(tag[1])
		}
	}
}

function load_events(damus) {
	if (!('event_cache' in localStorage))
		return {}
	const cached = JSON.parse(localStorage.getItem('event_cache'))

	return cached.reduce((obj, ev) => {
		obj[ev.id] = ev
		process_event(damus, ev)
		return obj
	}, {})
}

function load_cache(damus) {
	damus.all_events = load_events(damus)
	load_timelines(damus)
}

function save_cache(damus) {
	save_events(damus)
	save_timelines(damus)
}

function save_events(damus)
{
	const keys = Object.keys(damus.all_events)
	const MAX_KINDS = {
		1: 2000,
		0: 2000,

		6: 100,
		4: 100,
		5: 100,
		7: 100,
	}

	let counts = {}

	let cached = keys.map((key) => {
		const ev = damus.all_events[key]
		const {sig, pubkey, content, tags, kind, created_at, id} = ev
		return {sig, pubkey, content, tags, kind, created_at, id}
	})

	cached.sort((a,b) => b.created_at - a.created_at)
	cached = cached.reduce((cs, ev) => {
		counts[ev.kind] = (counts[ev.kind] || 0)+1
		if (counts[ev.kind] < MAX_KINDS[ev.kind])
			cs.push(ev)
		return cs
	}, [])

	log_debug('saving all events to local storage', cached.length)

	localStorage.setItem('event_cache', JSON.stringify(cached))
}

function save_timelines(damus)
{
	const views = Object.keys(damus.views).reduce((obj, view_name) => {
		const view = damus.views[view_name]
		obj[view_name] = view.events.map(e => e.id).slice(0,100)
		return obj
	}, {})
	localStorage.setItem('views', JSON.stringify(views))
}

function load_timelines(damus)
{
	if (!('views' in localStorage))
		return
	const stored_views = JSON.parse(localStorage.getItem('views'))
	for (const view_name of Object.keys(damus.views)) {
		const view = damus.views[view_name]
		view.events = (stored_views[view_name] || []).reduce((evs, evid) => {
			const ev = damus.all_events[evid]
			if (ev) evs.push(ev)
			return evs
		}, [])
	}
}

function handle_home_event(model, relay, sub_id, ev) {
	const ids = model.ids

	// ignore duplicates
	if (!has_event(model, ev.id)) {
		model.all_events[ev.id] = ev
		process_event(model, ev)
		schedule_save_events(model)
	}

	ev = model.all_events[ev.id]

	let is_new = true
	switch (sub_id) {
	case model.ids.explore:
		const view = model.views.explore

		// show more things in explore timeline
		if (should_add_to_explore_timeline(model.contacts, view, ev, model.pow)) {
			view.seen.add(ev.pubkey)
			is_new = insert_event_sorted(view.events, ev)
		}

		if (is_new)
			handle_redraw_logic(model, 'explore')
		break;

	case model.ids.notifications:
		if (should_add_to_notification_timeline(model.pubkey, model.contacts, ev, model.pow))
			is_new = insert_event_sorted(model.views.notifications.events, ev)

		if (is_new)
			handle_redraw_logic(model, 'notifications')
		break;

	case model.ids.home:
		if (should_add_to_timeline(ev))
			is_new = insert_event_sorted(model.views.home.events, ev)

		if (is_new)
			handle_redraw_logic(model, 'home')
		break;
	case model.ids.account:
		switch (ev.kind) {
		case 3:
			model.done_init[relay] = true
			model.pool.unsubscribe(model.ids.account, relay)
			send_home_filters(model, relay)
			break
		}
		break
	case model.ids.profiles:
		break
	}
}

function process_profile_event(model, ev) {
	const prev_ev = model.all_events[model.profile_events[ev.pubkey]]
	if (prev_ev && prev_ev.created_at > ev.created_at)
		return

	model.profile_events[ev.pubkey] = ev.id
	try {
		model.profiles[ev.pubkey] = JSON.parse(ev.content)
	} catch(e) {
		log_debug("failed to parse profile contents", ev)
	}
}

function send_initial_filters(account_id, pubkey, relay) {
	const filter = {authors: [pubkey], kinds: [3], limit: 1}
	//console.log("sending initial filter", filter)
	relay.subscribe(account_id, filter)
}

function send_home_filters(model, relay) {
	const ids = model.ids
	const friends = contacts_friend_list(model.contacts)
	friends.push(model.pubkey)
	const contacts_filter = {kinds: [0], authors: friends}
	const dms_filter = {kinds: [4], "#p": [ model.pubkey ], limit: 100}
	const our_dms_filter = {kinds: [4], authors: [ model.pubkey ], limit: 100}
	const standard_kinds = [1,42,5,6,7]
	const home_filter = {kinds: standard_kinds, authors: friends, limit: 500}
	// TODO: include pow+fof spam filtering in notifications query
	const notifications_filter = {kinds: standard_kinds, "#p": [model.pubkey], limit: 100}

	let home_filters = [home_filter]
	let notifications_filters = [notifications_filter]
	let contacts_filters = [contacts_filter]
	let dms_filters = [dms_filter, our_dms_filter]

	let last_of_kind = {}
	if (relay) {
		last_of_kind =
			model.last_event_of_kind[relay] =
			model.last_event_of_kind[relay] || calculate_last_of_kind(model.all_events);
		log_debug("last_of_kind", last_of_kind)
	}

	update_filters_with_since(last_of_kind, home_filters)
	update_filters_with_since(last_of_kind, contacts_filters)
	update_filters_with_since(last_of_kind, notifications_filters)
	update_filters_with_since(last_of_kind, dms_filters)

	const subto = relay? [relay] : undefined
	model.pool.subscribe(ids.home, home_filters, subto)
	model.pool.subscribe(ids.contacts, contacts_filters, subto)
	model.pool.subscribe(ids.notifications, notifications_filters, subto)
	model.pool.subscribe(ids.dms, dms_filters, subto)
}

function update_filter_with_since(last_of_kind, filter) {
	const kinds = filter.kinds || []
	let initial = null
	let earliest = kinds.reduce((earliest, kind) => {
		const last_created_at = last_of_kind[kind]
		let since = get_since_time(last_created_at)

		if (!earliest) {
			if (since === null)
				return null

			return since
		}

		if (since === null)
			return earliest

		return since < earliest ? since : earliest

	}, initial)
	if (earliest)
		filter.since = earliest;
}

function update_filters_with_since(last_of_kind, filters) {
	for (const filter of filters) {
		update_filter_with_since(last_of_kind, filter)
	}
}



function handle_profiles_loaded(ids, model, view, relay) {
	// stop asking for profiles
	model.pool.unsubscribe(ids.profiles, relay)

	//redraw_events(model, view)
	redraw_my_pfp(model)

	const prefix = difficulty_to_prefix(model.pow)
	const fofs = Array.from(model.contacts.friend_of_friends)
	const standard_kinds = [1,42,5,6,7]
	let pow_filter = {kinds: standard_kinds, limit: 50}
	if (model.pow > 0)
		pow_filter.ids = [ prefix ]

	let explore_filters = [ pow_filter ]

	if (fofs.length > 0) {
		explore_filters.push({kinds: standard_kinds, authors: fofs, limit: 50})
	}

	model.pool.subscribe(ids.explore, explore_filters, relay)
}

// load profiles after comment notes are loaded
function handle_comments_loaded(ids, model, events, relay) {
	const pubkeys = events.reduce((s, ev) => {
		s.add(ev.pubkey)
		for (const tag of ev.tags) {
			if (tag.length >= 2 && tag[0] === "p") {
				if (!model.profile_events[tag[1]])
					s.add(tag[1])
			}
		}
		return s
	}, new Set())
	const authors = Array.from(pubkeys)

	// load profiles and noticed chatrooms
	const profile_filter = {kinds: [0,3], authors: authors}

	let filters = []
	if (authors.length > 0)
		filters.push(profile_filter)
	if (filters.length === 0) {
		log_debug("No profiles filters to request...")
		return
	}

	//console.log("subscribe", profiles_id, filter, relay)
	log_debug("subscribing to profiles on %s", relay.url)
	model.pool.subscribe(ids.profiles, filters, relay)
}

function determine_event_refs_positionally(pubkeys, ids)
{
	if (ids.length === 1)
		return {root: ids[0], reply: ids[0], pubkeys}
	else if (ids.length >= 2)
		return {root: ids[0], reply: ids[1], pubkeys}

	return {pubkeys}
}

function determine_event_refs(tags) {
	let positional_ids = []
	let pubkeys = []
	let root
	let reply
	let i = 0

	for (const tag of tags) {
		if (tag.length >= 4 && tag[0] == "e") {
			positional_ids.push(tag[1])
			if (tag[3] === "root") {
				root = tag[1]
			} else if (tag[3] === "reply") {
				reply = tag[1]
			}
		} else if (tag.length >= 2 && tag[0] == "e") {
			positional_ids.push(tag[1])
		} else if (tag.length >= 2 && tag[0] == "p") {
			pubkeys.push(tag[1])
		}

		i++
	}

	if (!(root && reply) && positional_ids.length > 0)
		return determine_event_refs_positionally(pubkeys, positional_ids)

	/*
	if (reply && !root)
		root = reply
		*/

	return {root, reply, pubkeys}
}

function contacts_friend_list(contacts) {
	return Array.from(contacts.friends)
}

function contacts_friendosphere(contacts) {
	let s = new Set()
	let fs = []

	for (const friend of contacts.friends.keys()) {
		fs.push(friend)
		s.add(friend)
	}

	for (const friend of contacts.friend_of_friends.keys()) {
		if (!s.has(friend))
			fs.push(friend)
	}

	return fs
}

function add_contact_if_friend(contacts, ev) {
	if (!contact_is_friend(contacts, ev.pubkey))
		return

	add_friend_contact(contacts, ev)
}

function contact_is_friend(contacts, pk) {
	return contacts.friends.has(pk)
}

function add_friend_contact(contacts, contact) {
	contacts.friends.add(contact.pubkey)

	for (const tag of contact.tags) {
		if (tag.length >= 2 && tag[0] == "p") {
			if (!contact_is_friend(contacts, tag[1]))
				contacts.friend_of_friends.add(tag[1])
		}
	}
}

