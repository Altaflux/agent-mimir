import { z } from 'zod';

import type { JsonSchemaObject, Serializable } from '../types.js';

export const parseConst = (jsonSchema: JsonSchemaObject & { const: Serializable }) => {
	return z.literal(jsonSchema.const as z.Primitive);
};
