-- Treino e janela de traçado passam a durar 2 minutos cada, e a classificação das corridas teste vira uma sessão de
-- 60 s. Reajusta as corridas automáticas que ainda não começaram, mantendo o início do treino (o horário da corrida).
UPDATE "races" SET
  "trace_window_at" = "practice_at" + interval '2 minutes',
  "setup_lock_at" = "practice_at" + interval '4 minutes',
  "qualifying_at" = "practice_at" + interval '4 minutes' + ("qualifying_at" - "setup_lock_at"),
  "race_at" = "practice_at" + interval '4 minutes' + ("qualifying_at" - "setup_lock_at")
    + CASE WHEN "flags" ? 'autoTest' THEN interval '60 seconds' ELSE ("race_at" - "qualifying_at") END
WHERE ("flags" ? 'auto' OR "flags" ? 'autoTest')
  AND "status" IN ('scheduled', 'registration_open');
