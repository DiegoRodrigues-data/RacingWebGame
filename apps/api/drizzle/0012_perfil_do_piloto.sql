ALTER TABLE "profiles" ADD COLUMN "driver" jsonb;--> statement-breakpoint
-- Pistas mais largas (14 m) para as disputas lado a lado: só as configurações salvas com largura menor.
UPDATE "game_settings" SET "value" = jsonb_set("value", '{tracks,width}', '14'::jsonb)
  WHERE "value" ? 'tracks' AND ("value"->'tracks'->>'width')::numeric < 14;
--> statement-breakpoint
-- Sem a etapa de treino: a preparação vai da inscrição ao parque fechado (corridas já criadas mantêm os horários).
UPDATE "game_settings" SET "value" = jsonb_set("value", '{phases,practiceMin}', '0'::jsonb)
  WHERE "value" ? 'phases';
