ALTER TABLE "cells"
  ALTER COLUMN "current_value" TYPE numeric
  USING "current_value"::numeric;