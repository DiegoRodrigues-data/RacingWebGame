-- Corridas teste passam a rodar em ciclo (uma de cada vez). Remove as que foram pré-agendadas de 5 em 5 minutos e
-- ainda não começaram, desde que nenhum jogador humano esteja inscrito nelas.
DELETE FROM "races" r
WHERE r."flags" ? 'autoTest'
  AND r."status" IN ('scheduled', 'registration_open')
  AND NOT EXISTS (
    SELECT 1 FROM "entries" e JOIN "users" u ON u."id" = e."user_id"
    WHERE e."race_id" = r."id" AND NOT u."is_bot" AND e."status" IN ('confirmed', 'waitlisted')
  );
--> statement-breakpoint
-- Pistas procedurais que ficaram sem corrida.
DELETE FROM "tracks" t
WHERE t."kind" = 'procedural'
  AND NOT EXISTS (
    SELECT 1 FROM "track_versions" v JOIN "races" r ON r."track_version_id" = v."id" WHERE v."track_id" = t."id"
  );
