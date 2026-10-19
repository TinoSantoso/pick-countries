import { z } from 'zod';

/**
 * Upstream records are stored as-is; only fields the app depends on are validated.
 * looseObject keeps every other upstream field (and future additions) in the snapshot.
 */
export const countrySchema = z.looseObject({
  names: z.looseObject({
    common: z.string(),
    official: z.string().optional(),
    alternates: z.array(z.string()).optional(),
  }),
  codes: z.looseObject({
    alpha_2: z.string().length(2),
    alpha_3: z.string().length(3),
    cioc: z.string().optional(),
    fifa: z.string().optional(),
  }),
  region: z.string().optional(),
  subregion: z.string().optional(),
  capitals: z.array(z.looseObject({ name: z.string().optional() })).optional(),
  currencies: z
    .array(z.looseObject({ code: z.string().optional(), name: z.string().optional(), symbol: z.string().optional() }))
    .optional(),
  languages: z
    .array(
      z.looseObject({
        name: z.string().optional(),
        native_name: z.string().optional(),
        bcp47: z.string().optional(),
        iso639_1: z.string().optional(),
        iso639_3: z.string().optional(),
      }),
    )
    .optional(),
  flag: z.looseObject({ emoji: z.string().optional() }).optional(),
});

export type Country = z.infer<typeof countrySchema>;

/** Upstream list envelope; meta is loose because the demo key returns a reduced shape. */
export const listEnvelopeSchema = z.looseObject({
  data: z.looseObject({
    objects: z.array(z.unknown()),
    meta: z.looseObject({ total: z.number().optional(), more: z.boolean().optional() }).optional(),
  }),
});

export const upstreamErrorSchema = z.looseObject({
  errors: z.array(z.looseObject({ message: z.string().optional() })).min(1),
});

export type UpstreamPage = {
  objects: unknown[];
  more: boolean;
  total: number | null;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
  };
};
