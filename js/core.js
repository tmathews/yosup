const KIND_METADATA = 0;
const KIND_NOTE     = 1;
const KIND_RELAY    = 2;
const KIND_CONTACT  = 3;
const KIND_DM       = 4;
const KIND_DELETE   = 5;
const KIND_SHARE    = 6;
const KIND_REACTION = 7;
const KIND_CHATROOM = 42;

const TAG_P = "#p";
const TAG_E = "#e";

const R_HEART = "❤️";

const STANDARD_KINDS = [
	KIND_NOTE,
	KIND_DELETE,
	KIND_REACTION,
	KIND_SHARE,
];

function get_local_state(key) {
	if (DAMUS[key] != null)
		return DAMUS[key]
	return localStorage.getItem(key)
}

function set_local_state(key, val) {
	DAMUS[key] = val
	localStorage.setItem(key, val)
}

async function sign_id(privkey, id) {
	//const digest = nostrjs.hex_decode(id)
	const sig = await nobleSecp256k1.schnorr.sign(id, privkey)
	return nostrjs.hex_encode(sig)
}

async function broadcast_related_events(ev) {
	ev.tags
		.reduce((evs, tag) => {
			// cap it at something sane
			if (evs.length >= 5)
				return evs
			const ev = get_tag_event(tag)
			if (!ev)
				return evs
			insert_event_sorted(evs, ev) // for uniqueness
			return evs
		}, [])
		.forEach((ev, i) => {
			// so we don't get rate limited
			setTimeout(() => {
				log_debug("broadcasting related event", ev)
				broadcast_event(ev)
			}, (i+1)*1200)
		})
}

function broadcast_event(ev) {
	DAMUS.pool.send(["EVENT", ev])
}

async function update_profile(profile={}) {
	let ev = {
		kind: KIND_METADATA,
		created_at: new_creation_time(),
		pubkey: DAMUS.pubkey,
		content: JSON.stringify(profile),
		tags: [],
	};
	ev.id = await nostrjs.calculate_id(ev);
	ev = await sign_event(ev);
	broadcast_event(ev);
	return ev;
}

async function sign_event(ev) {
	if (window.nostr && window.nostr.signEvent) {
		const signed = await window.nostr.signEvent(ev)
		if (typeof signed === 'string') {
			ev.sig = signed
			return ev
		}
		return signed
	}

	const privkey = get_privkey()
	ev.sig = await sign_id(privkey, ev.id)
	return ev
}

async function send_post() {
	const input_el = document.querySelector("#post-input")
	const cw_el = document.querySelector("#content-warning-input")
	const cw = cw_el.value
	const content = input_el.value
	const created_at = new_creation_time()
	const kind = 1
	const tags = cw ? [["content-warning", cw]] : []
	const pubkey = await get_pubkey()

	let post = { pubkey, tags, content, created_at, kind }
	post.id = await nostrjs.calculate_id(post)
	post = await sign_event(post)
	broadcast_event(post)

	input_el.value = ""
	cw_el.value = ""
	post_input_changed(input_el)
}


async function create_reply(pubkey, content, from) {
	const tags = gather_reply_tags(pubkey, from)
	const created_at = Math.floor(new Date().getTime() / 1000)
	let kind = from.kind

	// convert emoji replies into reactions
	if (is_valid_reaction_content(content))
		kind = 7

	let reply = { pubkey, tags, content, created_at, kind }

	reply.id = await nostrjs.calculate_id(reply)
	reply = await sign_event(reply)
	return reply
}

async function send_reply(content, replying_to) {
	const ev = DAMUS.all_events[replying_to]
	if (!ev)
		return

	const pubkey = await get_pubkey()
	let reply = await create_reply(pubkey, content, ev)

	broadcast_event(reply)
	broadcast_related_events(reply)
}

async function create_deletion_event(pubkey, target, content="") {
	const created_at = Math.floor(new Date().getTime() / 1000)
	let kind = 5

	const tags = [["e", target]]
	let del = { pubkey, tags, content, created_at, kind }

	del.id = await nostrjs.calculate_id(del)
	del = await sign_event(del)
	return del
}

async function delete_post(id, reason) {
	const ev = DAMUS.all_events[id]
	if (!ev)
		return

	const pubkey = await get_pubkey()
	let del = await create_deletion_event(pubkey, id, reason)
	broadcast_event(del)
}

function model_get_reacts_to(model, pubkey, evid, emoji) {
	const r = model.reactions_to[evid];
	if (!r)
		return;
	for (const id of r.keys()) {
		if (model_is_event_deleted(model, id))
			continue;
		const reaction = model.all_events[id];
		if (!reaction || reaction.pubkey != pubkey)
			continue;
		if (emoji == get_reaction_emoji(reaction))
			return reaction;
	}
	return;
}

function get_reactions(model, evid) {
	const reactions_set = model.reactions_to[evid]
	if (!reactions_set)
		return ""

	let reactions = []
	for (const id of reactions_set.keys()) {
		if (model_is_event_deleted(model, id))
			continue
		const reaction = model.all_events[id]
		if (!reaction)
			continue
		reactions.push(reaction)
	}

	const groups = reactions.reduce((grp, r) => {
		const e = get_reaction_emoji(r)
		grp[e] = grp[e] || {}
		grp[e][r.pubkey] = r
		return grp
	}, {})

	return groups
}

function gather_reply_tags(pubkey, from) {
	let tags = []
	let ids = new Set()

	if (from.refs && from.refs.root) {
		tags.push(["e", from.refs.root, "", "root"])
		ids.add(from.refs.root)
	}

	tags.push(["e", from.id, "", "reply"])
	ids.add(from.id)

	for (const tag of from.tags) {
		if (tag.length >= 2) {
			if (tag[0] === "p" && tag[1] !== pubkey) {
				if (!ids.has(tag[1])) {
					tags.push(["p", tag[1]])
					ids.add(tag[1])
				}
			}
		}
	}
	if (from.pubkey !== pubkey && !ids.has(from.pubkey)) {
		tags.push(["p", from.pubkey])
	}
	return tags
}

function get_tag_event(tag) {
	if (tag.length < 2)
		return null
	if (tag[0] === "e")
		return DAMUS.all_events[tag[1]]
	if (tag[0] === "p")
		return DAMUS.all_events[DAMUS.profile_events[tag[1]]]
	return null
}

function* yield_etags(tags) {
	for (const tag of tags) {
		if (tag.length >= 2 && tag[0] === "e")
			yield tag
	}
}

function get_content_warning(tags) {
	for (const tag of tags) {
		if (tag.length >= 1 && tag[0] === "content-warning")
			return tag[1] || ""
	}
	return null
}

async function get_nip05_pubkey(email) {
	const [user, host] = email.split("@")
	const url = `https://${host}/.well-known/nostr.json?name=${user}`

	try {
		const res = await fetch(url)
		const json = await res.json()
		log_debug("nip05 data", json)
		return json.names[user]
	} catch (e) {
		log_error("fetching nip05 entry for %s", email, e)
		throw e
	}
}

// TODO rename handle_pubkey to fetch_pubkey
async function handle_pubkey(pubkey) {
	if (pubkey[0] === "n")
		pubkey = bech32_decode(pubkey)
	if (pubkey.includes("@"))
		pubkey = await get_nip05_pubkey(pubkey)
	set_local_state('pubkey', pubkey)
	return pubkey
}

