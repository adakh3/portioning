"""The kinds of client message, in one place both the sender and the templates
can import without importing each other."""

# The client is being asked to review and sign — carries the booking PDF.
KIND_SIGN_LINK = 'sign_link'
# The client has signed — carries the frozen signed PDF.
KIND_SIGNED_COPY = 'signed_copy'
# An ordinary message the rep writes; no attachment.
KIND_COMPOSE = 'compose'

ALL_KINDS = (KIND_SIGN_LINK, KIND_SIGNED_COPY, KIND_COMPOSE)
