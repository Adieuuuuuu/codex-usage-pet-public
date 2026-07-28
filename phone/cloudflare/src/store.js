import { constantTimeEqual } from "./protocol.js";

const SELECT_STATE_SQL = `
  SELECT
    auth_hash AS authHash,
    sequence,
    envelope,
    updated_at AS updatedAt
  FROM room_state
  WHERE singleton = 1
`;

export class SqliteRoomStore {
  constructor(storage) {
    this.storage = storage;
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        auth_hash TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        envelope TEXT NOT NULL,
        updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
      )
    `);
  }

  getState() {
    return this.storage.sql.exec(SELECT_STATE_SQL).toArray()[0] ?? null;
  }

  publish(authHash, sequence, envelope, updatedAt) {
    return this.storage.transactionSync(() => {
      const current = this.getState();
      const decision = publicationDecision(current, authHash, sequence);

      if (decision === "claim") {
        this.storage.sql.exec(
          `
            INSERT INTO room_state (
              singleton,
              auth_hash,
              sequence,
              envelope,
              updated_at
            ) VALUES (1, ?, ?, ?, ?)
          `,
          authHash,
          sequence,
          envelope,
          updatedAt,
        );
      } else if (decision === "update") {
        this.storage.sql.exec(
          `
            UPDATE room_state
            SET sequence = ?, envelope = ?, updated_at = ?
            WHERE singleton = 1
          `,
          sequence,
          envelope,
          updatedAt,
        );
      }

      return {
        decision,
        previousSequence: current?.sequence ?? null,
      };
    });
  }
}

export function publicationDecision(current, authHash, sequence) {
  if (current === null) {
    return "claim";
  }
  if (!constantTimeEqual(current.authHash, authHash)) {
    return "unauthorized";
  }
  if (sequence <= current.sequence) {
    return "stale";
  }
  return "update";
}
