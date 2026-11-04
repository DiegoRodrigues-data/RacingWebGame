-- Zera as corridas para começar a grade automática (uma corrida por hora) do zero.
-- Apaga corridas e tudo que depende delas (inscrições, traçados, setups, classificação, replays e resultados, por cascata).
DELETE FROM "races";
--> statement-breakpoint
-- Rankings da temporada são somas dos resultados apagados.
DELETE FROM "ranking_entries";
--> statement-breakpoint
-- Avisos que apontam para corridas que não existem mais.
DELETE FROM "notifications" WHERE "payload" ? 'raceId';
--> statement-breakpoint
-- Pistas procedurais eram uma por corrida; as especiais (criadas no editor) ficam.
DELETE FROM "tracks" WHERE "kind" = 'procedural';
