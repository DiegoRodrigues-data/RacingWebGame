-- A janela de traçado depois do treino saiu (o traçado é editado da inscrição até o parque fechado).
-- Corridas que ainda não começaram perdem a janela: o parque fechado começa no fim do treino e classificação e
-- largada são antecipadas na mesma medida. Corridas em andamento ou encerradas não mudam.
UPDATE "races"
SET
  "qualifying_at" = "qualifying_at" - ("setup_lock_at" - "trace_window_at"),
  "race_at" = "race_at" - ("setup_lock_at" - "trace_window_at"),
  "setup_lock_at" = "trace_window_at"
WHERE "status" IN ('scheduled', 'registration_open')
  AND "setup_lock_at" > "trace_window_at";
