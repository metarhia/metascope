export interface User {
  id: number;
  name: string;
}
export type Id = string | number;
const greet = (u: User): string => `Hi ${u.name}`;
