function linkify(text="", show_media=false) {
	return text.replace(URL_REGEX, function(match, p1, p2, p3) {
		const url = p2+p3;
		let parsed;
		try {
			parsed = new URL(url)
		} catch (err) {
			return match;
		}
		let markup;
		if (show_media && is_img_url(parsed.pathname)) {
			markup = html`
			<img class="inline-img clickable" src="${url}" onclick="open_media_preview('${url}', 'image')"/>
			`;
		} else if (show_media && is_video_url(parsed.pathname)) {
			markup = html`
			<video controls class="inline-img" />
			  <source src="${url}">
			</video>
			`;
		} else {
			markup = html`<a target="_blank" rel="noopener noreferrer" href="${url}">${url}</a>`;
		}
		return p1+markup;
	})
}

function format_content(ev, show_media) {
	if (ev.kind === 7) {
		if (ev.content === "" || ev.content === "+")
			return "❤️"
		return sanitize(ev.content.trim());
	}
	const content = sanitize(ev.content.trim());
	const body = convert_quote_blocks(content, show_media)
	let cw = get_content_warning(ev.tags)
	if (cw !== null) {
		let cwHTML = "Content Warning"
		if (cw === "") {
			cwHTML += "."
		} else {
			cwHTML += `: "<span>${cw}</span>".`
		}
		return `
		<details class="cw">
		  <summary class="event-message">${cwHTML}</summary>
		  ${body}
		</details>
		`
	}
	return body
}

function convert_quote_blocks(content, show_media)
{
	const split = content.split("\n")
	let blockin = false
	return split.reduce((str, line) => {
		if (line !== "" && line[0] === '>') {
			if (!blockin) {
				str += "<span class='quote'>"
				blockin = true
			}
			str += linkify(sanitize(line.slice(1)), show_media)
		} else {
			if (blockin) {
				blockin = false
				str += "</span>"
			}
			str += linkify(sanitize(line), show_media)
		}
		return str + "<br/>"
	}, "")
}

/* format_profile_name takes in a profile and tries it's best to return a string
 * that is best suited for the profile. It also assigns the sanitized_name to
 * the profile.
 */
function fmt_profile_name(profile={}, fallback="Anonymous") {
	if (profile.sanitized_name)
		return profile.sanitized_name
	const name = profile.display_name || profile.user || profile.name || 
		fallback	
	profile.sanitized_name = sanitize(name)
	return profile.sanitized_name
}

function fmt_pubkey(pk) {
	return pk.slice(-8)
}


