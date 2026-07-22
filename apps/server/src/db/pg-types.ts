// node-pg returns int8 (bigint) as strings to avoid precision loss. Our ids
// are bigint in the DB but safely below 2^53 at this scale (decision J), so
// parse them as numbers once, globally - otherwise every raw query returns
// string ids. Import for side effect before creating any Pool.
import pg from 'pg';

pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => Number(v));
