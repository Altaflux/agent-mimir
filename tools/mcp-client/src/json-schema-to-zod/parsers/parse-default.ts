import { z } from 'zod';

import type { JsonSchemaObject } from '../types.js';

export const parseDefault = (_jsonSchema: JsonSchemaObject) => {
	return z.any();
};
