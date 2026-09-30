/** A function a teller can be entitled to. */
export type Entitlement = 'member_inquiry' | 'open_subaccount';

/** A teller login. The seeded pairs are synthetic and documented in the README; they guard nothing real. */
export interface User {
	readonly userId: string;
	readonly password: string;
	readonly displayName: string;
	readonly entitlements: readonly Entitlement[];
}

/** The seeded synthetic teller logins (`teller01` full access, `teller02` inquiry only). */
export const USERS: readonly User[] = [
	{
		userId: 'teller01',
		password: 'synthetic-pass-01',
		displayName: 'Teller One',
		entitlements: ['member_inquiry', 'open_subaccount'],
	},
	{
		userId: 'teller02',
		password: 'synthetic-pass-02',
		displayName: 'Teller Two',
		entitlements: ['member_inquiry'],
	},
];

/** Checks a User ID / Password pair. Returns the user on a match. */
export function authenticate(userId: string, password: string): User | undefined {
	return USERS.find((user) => user.userId === userId && user.password === password);
}
