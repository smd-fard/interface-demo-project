/**
 * The synthetic member data set. Every value is obviously fake: names are placeholders, SSNs are in the
 * never-issued 900 range, account numbers are made up. Fields that *look* sensitive (SSN, full account
 * numbers, balances) exist so the system's redaction has something real to catch.
 */
export interface Member {
	readonly id: string;
	readonly name: string;
	/** Full fake SSN (900 range). Screens show only `***-**-` + the last four digits. */
	readonly ssn: string;
	readonly memberSince: string;
	readonly branch: string;
	readonly shareSavings: { readonly accountNumber: string; readonly balance: string };
	readonly checking: { readonly accountNumber: string; readonly balance: string };
}

/** The seeded synthetic members. */
export const MEMBERS: readonly Member[] = [
	{
		id: '12345',
		name: 'Jane Sample',
		ssn: '900-12-3456',
		memberSince: '03/14/2011',
		branch: '001 MAIN',
		shareSavings: { accountNumber: '8800123450', balance: '1523.47' },
		checking: { accountNumber: '8800123451', balance: '842.10' },
	},
	{
		id: '12346',
		name: 'John Placeholder',
		ssn: '901-23-4567',
		memberSince: '07/02/2015',
		branch: '002 EAST',
		shareSavings: { accountNumber: '8800123460', balance: '904.00' },
		checking: { accountNumber: '8800123461', balance: '12.35' },
	},
	{
		id: '24680',
		name: 'Ada Fixture',
		ssn: '902-34-5678',
		memberSince: '11/30/2019',
		branch: '001 MAIN',
		shareSavings: { accountNumber: '8800246800', balance: '10250.00' },
		checking: { accountNumber: '8800246801', balance: '3999.99' },
	},
];

/** Looks a member up by member number. */
export function findMember(id: string): Member | undefined {
	return MEMBERS.find((member) => member.id === id);
}

/** The SSN as the screens show it: `***-**-` and the last four digits. */
export function maskedSsn(member: Member): string {
	return `***-**-${member.ssn.slice(-4)}`;
}
