# Summary — IMP-001

Root cause: full-agent prompt security text “installation tokens” false-positive on secret sentinel → child never started → empty parent Session + Internal error.

Fixed: tighter sentinel, envelope wording, typed preflight meta, projection truthfulness. Offline suites green. 30142 re-proof recommended after rebuild; 30141 not killed. Not #22 business completion.
