import { z } from 'zod';

import type { JsonSchemaObject } from '../types.js';

export const parseBoolean = (_jsonSchema: JsonSchemaObject & { type: 'boolean' }) => {
	return z.boolean();
};
