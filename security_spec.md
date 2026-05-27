# Security Specification - VirtualDJ Pro

## Data Invariants
- A user can only read and write their own profile, cue points, and history.
- Song requests are public for reading (to show the request list), but can only be created by signed-in users.
- Only the creator of a song request can delete or modify it (unless they are an admin).
- Timestamps must be server-generated.

## The Dirty Dozen Payloads (Rejection Targets)
1. Creating a user profile for a different UID.
2. Updating `createdAt` in a user profile.
3. Adding a cue point with a 5MB string label.
4. Update a song request status from `pending` to `added` by a non-admin.
5. Deleting another user's history item.
6. Reading the `private` split collection of another user (if used).
7. Injecting non-alphanumeric IDs.
8. Writing a `songRequest` without a `requestedAt` timestamp.
9. Updating `ownerId` of any resource.
10. Creating a `cuePoint` without being signed in.
11. Bypassing size limits on track titles.
12. Modifying a history item after it was created (immutability).

## Rules Logic Draft
- `isValidUser`: Checks keys, type, and auth match.
- `isValidCuePoint`: Checks keys, trackId size, position type.
- `isValidRequest`: Checks keys, status enum.
- `isOwner(userId)`: `request.auth.uid == userId`.
