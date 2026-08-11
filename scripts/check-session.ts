import { Database } from "bun:sqlite"
const db = new Database("C:/Users/jxc1/.local/share/opencode/opencode.db", { readonly: true })
const row = db
  .query(
    "SELECT id, project_id, workspace_id, parent_id, directory, path, time_created, time_updated, time_archived FROM session",
  )
  .all()
console.log("sessions:", JSON.stringify(row, null, 2))
const msgs = db.query("SELECT count(*) as c FROM message").get() as any
console.log("message count:", msgs.c)
const tabs = db.query("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name)
console.log("tables:", tabs.join(","))
db.close()
