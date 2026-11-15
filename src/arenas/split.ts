import { createHash } from 'node:crypto';

// Which split a task goes to, from its id alone: 60 in 100 breeding, 25 race, 15 sealed. The
// same id always lands in the same split, so a rebuilt arena keeps its sealed tasks sealed.
const bucket = (id: string) => createHash('sha1').update(id).digest().readUInt32BE(0) % 100;
export const splitOf = (id: string): 'breeding' | 'race' | 'sealed' => bucket(id) < 60 ? 'breeding' : bucket(id) < 85 ? 'race' : 'sealed';
