import { parseSchema } from './parse-schema.js';
import type { JsonSchemaObject, Refs } from '../types.js';
import { omit } from '../utils/omit.js';

/**
 * For compatibility with open api 3.0 nullable
 */
export const parseNullable = (jsonSchema: JsonSchemaObject & { nullable: true }, refs: Refs) => {
	return parseSchema(omit(jsonSchema, 'nullable'), refs, true).nullable();
};
