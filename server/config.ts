import 'dotenv/config';
import { z } from 'zod';
// Node owns local transport ports only. Python owns model configuration.
export const config = z.object({ PORT: z.coerce.number().int().min(1024).max(65535).default(5180),
    PYTHON_AGENT_PORT: z.coerce.number().int().min(1024).max(65535).default(8176) }).parse(process.env);
export type Config = typeof config;
