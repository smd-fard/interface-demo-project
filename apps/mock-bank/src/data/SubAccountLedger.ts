/** The sub-account products the Open Sub-Account form offers. */
export const PRODUCTS = ['Holiday Club', 'Vacation Savings'] as const;
/** A sub-account product offered on Open Sub-Account. */
export type Product = (typeof PRODUCTS)[number];

/** A sub-account request the teller has entered but not yet confirmed. */
export interface PendingSubAccount {
	readonly memberId: string;
	readonly product: Product;
	readonly initialDeposit: string;
	readonly nickname: string;
}

/** A committed sub-account. */
export interface OpenedSubAccount extends PendingSubAccount {
	readonly confirmationNumber: string;
	readonly accountNumber: string;
}

/** In-memory ledger of opened sub-accounts with a deterministic confirmation sequence (`SA-000001`, …). */
export class SubAccountLedger {
	private sequence = 0;
	private readonly opened: OpenedSubAccount[] = [];

	/** Commits a pending request. Irreversible (until an admin reset). */
	open(pending: PendingSubAccount): OpenedSubAccount {
		this.sequence += 1;
		const seq = String(this.sequence).padStart(6, '0');
		const account: OpenedSubAccount = {
			...pending,
			confirmationNumber: `SA-${seq}`,
			accountNumber: `99${String(this.sequence).padStart(8, '0')}`,
		};
		this.opened.push(account);
		return account;
	}

	all(): readonly OpenedSubAccount[] {
		return this.opened;
	}

	reset(): void {
		this.sequence = 0;
		this.opened.length = 0;
	}
}
