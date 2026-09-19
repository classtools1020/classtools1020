/** 寫入操作紀錄（在交易內使用時傳入 client）。 */
export async function audit(client, user, action, entity, entityId, before, after) {
  await client.query(
    `INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, before, after)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [user?.id ?? null, user?.name ?? null, action, entity, entityId ?? null,
      before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)],
  );
}
