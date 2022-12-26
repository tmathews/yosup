# Yo, Sup? 

Yo Sup? or simply "Yo" for short is a web client for the Nostr protocol. Its
aim is to be as good of an experience (if not better than) as Twitter. Note Yo
will not be the same as Twitter and will not implement all of it's features.
Nor will Yo try to implement all of Nostr's features as there are many.

The true purpose of Yo is to provide a great experience on any platform for 
anyone. It should be easy to use and understand making it a great option for 
people coming from other social networks to engage in their community.

Yo comes from the legacy Damus Web app an holds all of its history. It has been
rewritten to accomodate for the scale issues that we have seen so that it can 
continue to be used. The main reason for branching off is due to the lack of 
parity between Damus iOS (and new codebase improvements) and that of what the 
web version would support.

New minor features will continue to be added, but nothing substancial without
full time maintainers. Security will always be a top concern.

[Issue Tracker](https://todo.sr.ht/~tomtom/damus-web-issues)

## Contribution Guide

There are rules to contributing to this client. Please ensure you read them 
before making changes and supplying patch notes.

 - No transpilers. All source code should work out of the box.
 - Keep source code organised. Refer to the folder structure. If you have a
   question, ask it.
 - Do not include your personal tools in the source code. Use your own scripts
   outside of the project. This does not include build tools such as Make.
 - Use tabs & write JS with snake_case. End of discussion.
 - Do not include binary files.
 - No NPM (and kin) environments. If you need a file from an external resource
   mark the location in the "sources" file and add it to the repo.
 - No frameworks. Learn the browser tools and write good code. 
 - No experimental browser APIs.
 - Do not write animations in JavaScript, CSS only. Keep them short and snappy.
   Animations should not be a forefront, but an enjoyable addition.
 - All new & modified code should be properly documented.
 - Source code should be readable in the browser.
 - Search for the TODOs.

These rules are subject to discussion.

## Terminology

 * Sign Out  - Not "log out", "logout", "log off", etc.
 * Sign In   - Not "login", "log in", "signin", "sign-in", etc.
 * Share     - Not "boosted", "retweeted", "repost", etc.
 * Send      - Not "tweet", "toot", "post", etc.
 * Link      - Not "share".

## Known Issues 

 * You cannot send events when running from an IP address that is not secure. 
   Work arounds are not known at this time.

