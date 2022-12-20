FROM golang:1.19.1-alpine3.16
RUN go install git.sr.ht/~tomtom/http-server@latest
ADD . . 
CMD http-server -spa -cors -default=index.html -address=:80 ./web

