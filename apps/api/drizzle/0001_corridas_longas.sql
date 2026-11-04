-- Corridas longas (30 a 60 voltas) e parada obrigatória nos boxes.
-- Categorias do seed: voltas e velocidade de transmissão novas.
UPDATE "categories" SET "config" = jsonb_set(jsonb_set("config", '{laps}', to_jsonb(v.laps)), '{playbackSpeed}', to_jsonb(v.speed))
FROM (VALUES
  ('copa-novatos', 30, 2),
  ('liga-amadora', 40, 3),
  ('rali-terra', 35, 3),
  ('pro-series', 50, 4),
  ('elite-gp', 60, 5)
) AS v(slug, laps, speed)
WHERE "categories"."slug" = v.slug;
--> statement-breakpoint
-- Demais categorias: voltas dentro de 30..60.
UPDATE "categories"
SET "config" = jsonb_set("config", '{laps}', to_jsonb(GREATEST(30, LEAST(60, ("config"->>'laps')::int))))
WHERE ("config"->>'laps')::int NOT BETWEEN 30 AND 60;
--> statement-breakpoint
-- A parada obrigatória exige que a categoria permita ao menos uma parada.
UPDATE "categories"
SET "config" = jsonb_set("config", '{setupLimits,maxPitStops}', '1'::jsonb)
WHERE ("config"->'setupLimits'->>'maxPitStops')::int < 1;
--> statement-breakpoint
-- Corridas que ainda aceitam setup herdam as voltas da categoria (as que já travaram o setup ficam como estão).
UPDATE "races" SET "laps" = ("categories"."config"->>'laps')::int
FROM "categories"
WHERE "races"."category_id" = "categories"."id"
  AND "races"."status" IN ('scheduled', 'registration_open', 'practice', 'trace_window');
--> statement-breakpoint
-- Setups já salvos sem parada nessas corridas ganham uma troca para pneu duro no meio da prova.
UPDATE "setups"
SET "setup" = jsonb_set("setups"."setup", '{pitStops}', jsonb_build_array(jsonb_build_object('lap', "races"."laps" / 2, 'tyre', 'hard')))
FROM "races", "categories"
WHERE "setups"."race_id" = "races"."id"
  AND "races"."category_id" = "categories"."id"
  AND "races"."status" IN ('scheduled', 'registration_open', 'practice', 'trace_window')
  AND jsonb_array_length("setups"."setup"->'pitStops') = 0
  AND "categories"."config"->'setupLimits'->'allowedTyres' ? 'hard';
