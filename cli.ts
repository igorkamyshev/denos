import { assert } from "https://deno.land/std@0.212.0/assert/assert.ts";

import { resolve } from "./dns.ts";

const domain = Deno.args.at(0);

assert(domain, "Domain required as first argument");

const ip = await resolve(domain);

console.log(domain, ip);
