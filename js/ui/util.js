/* This file contains utility functions related to UI manipulation. Some code
 * may be specific to areas of the UI and others are more utility based. As
 * this file grows specific UI area code should be migrated to its own file.
 */

/* toggle_gnav hides or shows the global navigation's additional buttons based
 * on its opened state.
 */
function toggle_gnav(el) {
	el.parentElement.classList.toggle("open");
}

function close_gnav() {
	find_node("#gnav").classList.remove("open");
}

/* init_message_textareas finds all message textareas and updates their initial
 * height based on their content (0). This is so there is no jaring affect when
 * the page loads.
 */
function init_message_textareas() {
	const els = document.querySelectorAll(".post-input");
	for (const el of els) {
		trigger_postbox_assess(el);
	}
}

// update_notification_markers will find all markers and hide or show them
// based on the passed in state of 'active'. This applies to the navigation 
// icons.
function update_notification_markers(active, type) {
	let els = document.querySelectorAll(`.new-notifications[role='${type}']`)
	for (const el of els) {
		el.classList.toggle("hide", !active)
	}
}

/* newlines_to_br takes a string and converts all newlines to HTML 'br' tags.
 */
function newlines_to_br(str="") {
	return str.split("\n").reduce((acc, part, index) => {
		return acc + part + "<br/>";
	}, "");
}

function show_new() {
	view_timeline_show_new(DAMUS);
}

function click_share(el) {
	share(el.dataset.evid);
}

function click_toggle_like(el) {
	// Disable the button to prevent multiple presses
	el.disabled = true;
	if (el.dataset.liked == "yes") {
		delete_post(el.dataset.reactionId);
		return;
	}
	send_reply(R_HEART, el.dataset.reactingTo);
}

/* open_media_preview presents a modal to display an image via "url".
 */
function open_media_preview(url, type) {
	const el = find_node("#media-preview");
	el.classList.remove("closed");
	find_node("img", el).src = url;
	// TODO handle different medias such as audio and video
	// TODO add loading state & error checking
}

/* close_media_preview closes any present media modal.
 */
function close_media_preview() {
	find_node("#media-preview").classList.add("closed");
}

function delete_post_confirm(evid) {
	if (!confirm("Are you sure you want to delete this post?"))
		return;
	const reason = (prompt("Why you are deleting this? Leave empty to not specify. Type CANCEL to cancel.") || "").trim()
	if (reason.toLowerCase() === "cancel")
		return;
	delete_post(evid, reason)
}

async function do_send_reply() {
	const modal = document.querySelector("#reply-modal");
	const replying_to = modal.querySelector("#replying-to");
	const evid = replying_to.dataset.evid;
	const all = replying_to.dataset.toAll != "";
	const reply_content_el = document.querySelector("#reply-content");
	const content = reply_content_el.value;
	await send_reply(content, evid, all);
	reply_content_el.value = "";
	close_modal(modal);
}

function reply(evid, all=false) {
	const ev = DAMUS.all_events[evid]
	const modal = document.querySelector("#reply-modal")
	const replybox = modal.querySelector("#reply-content")
	const replying_to = modal.querySelector("#replying-to")
	replying_to.dataset.evid = evid
	replying_to.dataset.toAll = all ? "all" : "";
	replying_to.innerHTML = render_event_nointeract(DAMUS, ev, {
		is_composing: true, 
		nobar: true
	});
	modal.classList.remove("closed")
	replybox.focus()
}

function reply_author(evid) {
	reply(evid);
}

function reply_all(evid) {
	reply(evid, true);
}

function update_favicon(path) {
	let link = document.querySelector("link[rel~='icon']");
	const head = document.getElementsByTagName('head')[0]

	if (!link) {
		link = document.createElement('link');
		link.rel = 'icon';
		head.appendChild(link);
	}

	link.href = path;
}

// update_notifications updates the document title & visual indicators based on if the
// number of notifications that are unseen by the user.
function update_notifications(model) {
	let dm_count = 0;
	for (const item of model.dms) {
		if (item[1].new_count)
			dm_count += item[1].new_count;
	}
	
	const { count } = model.notifications;
	const suffix = "Yo Sup";
	const total = count + dm_count;
	document.title = total ? `(${total}) ${suffix}` : suffix;
	// TODO I broke the favicons; I will fix with later.
	//update_favicon(has_notes ? "img/damus_notif.svg" : "img/damus.svg");
	update_notification_markers(count, "activity");
	update_notification_markers(dm_count, "dm");
}

async function get_pubkey(use_prompt=true) {
	let pubkey = get_local_state('pubkey')
	if (pubkey)
		return pubkey
	if (window.nostr && window.nostr.getPublicKey) {
		log_debug("calling window.nostr.getPublicKey()...")
		try {
			pubkey = await window.nostr.getPublicKey()
			return await handle_pubkey(pubkey)
		} catch (err) {
			return;
		}
		log_debug("got %s pubkey from nos2x", pubkey)
	}
	if (!use_prompt)
		return;
	pubkey = prompt("Enter Nostr ID (eg: jb55@jb55.com) or public key (hex or npub).")
	if (!pubkey.trim())
		return;
	return await handle_pubkey(pubkey)
}

function get_privkey() {
	let privkey = get_local_state('privkey')
	if (privkey)
		return privkey
	if (!privkey)
		privkey = prompt("Enter private key")
	if (!privkey)
		throw new Error("can't get privkey")
	if (privkey[0] === "n") {
		privkey = bech32_decode(privkey)
	}
	set_local_state('privkey', privkey)
	return privkey
}

function open_thread(thread_id) {
	view_timeline_apply_mode(DAMUS, VM_THREAD, { thread_id });
}

function open_faqs() {
	find_node("#faqs").classList.remove("closed");
}

function close_modal(el) {
	while (el) {
		if (el.classList.contains("modal")) {
			el.classList.add("closed");
			break;
		}
		el = el.parentElement;
	}
}

function on_click_show_event_details(evid) {
	const model = DAMUS;
	const ev = model.all_events[evid];
	if (!ev)
		return;
	const el = find_node("#event-details");
	el.classList.remove("closed");
	find_node("code", el).innerText = JSON.stringify(ev, null, "\t");
}

function onclick_pfp(ev) {
	open_profile(ev.target.dataset.pubkey);	
}

function onerror_pfp(ev) {
	ev.target.src = IMG_NO_USER;
}
