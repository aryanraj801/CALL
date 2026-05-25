# NexaLink Data Privacy & GDPR Article 30 Compliance Manual

NexaLink operates as a **zero-persistence, privacy-first real-time communications network**. This policy manual details how user assets, transcripts, and session metadata comply with EU GDPR (Right to Erasure) and CCPA regulations.

---

## 1. Pseudonymization of Data Streams (Privacy Alias Engine)

* **Objective**: Ensure that server logging contains no personally identifiable information (PII).
* **Policy**: 
  * When a participant activates **Privacy Alias Mode**, real handles, emails, and device identifiers are stripped at the ingress middleware.
  * Server logs map clients to temporary aliases (e.g., `GhostParticipant_4938`) server-side.
  * Real user identifier keys are stored exclusively in client memory spaces; key maps are never written to disk or database logs.

---

## 2. Ephemeral Room Lifecycles & Automated Purging

* **Objective**: Enforce zero-knowledge session persistence.
* **Policy**:
  * For rooms flagged as `ephemeral_mode=True`, the room state database is completely purged immediately after the last participant disconnects.
  * **60-Second Cooldown**: To protect against accidental disconnections, a grace period of 60 seconds is configured. Once exceeded, background schedulers trigger cascading database purging.
  * **S3/R2 Cloud Lifecycle Purges**: All recorded media chunk files generated inside ephemeral rooms are assigned immediate object storage bucket lifecycle deletion policies (TTL of 1 hour).

---

## 3. Right to Erasure (GDPR Article 17) & Cascading Deletes

* **Objective**: Allow users to instantly and permanently erase transcripts and message records.
* **Policy**:
  * Users can submit a delete payload to `/api/recordings/erase`.
  * The backend API executes a **Cascading Deletion Transaction**:
    1. Removes database row identifiers in `recordings` mapping.
    2. Issues asynchronous purge triggers to S3-compatible cloud storage buckets to wipe the binary media chunks.
    3. Issues direct delete documents requests to Elasticsearch index pools to erase transcript search maps.

---

## 4. Selective Recording Consent Flow

* **Objective**: Guarantee explicit consent (opt-in) under GDPR Article 7.
* **Policy**:
  * No audio or video stream recording is enabled by default.
  * When a host initiates recording, a blocking pop-up triggers on every client system.
  * Streams are only composite-mixed for participants who select `consent_granted=True`. Non-consenting streams are filtered out at the media server ingress port, recording blank frames.
