/**
 * @typedef {{symmetric?: boolean, infer?: boolean}} MatchOptions
 * @typedef {import('./../types.js').Clue} Clue
 * 
 * @typedef {{suitIndex: number, rank: number}} BasicCard
 */

/**
 * Class for a single card (i.e. a suitIndex and rank). Other attributes are optional.
 */
export class Card {
	suitIndex = -1;		// The index of the card's suit
	rank = -1;			// The rank of the card
	order = -1;			// The ordinal number of the card

	clues = /** @type {Clue[]} */ ([]);			// List of clues that have touched this card
	possible = /** @type {Card[]} */ ([]);		// All possibilities of the card (from positive/negative information)
	inferred = /** @type {Card[]} */ ([]);		// All inferences of the card (from conventions)
	old_inferred = /** @type {Card[] | undefined} */ (undefined);		// Only used when undoing a finesse

	// Boolean flags about the state of the card
	clued = false;
	newly_clued = false;
	finessed = false;
	chop_moved = false;
	reset = false;			// Whether the card has previously lost all inferences

	reasoning = /** @type {number[]} */ ([]);		// The action indexes of when the card's possibilities/inferences were updated
	reasoning_turn = /** @type {number[]} */ ([]);	// The game turns of when the card's possibilities/inferences were updated
	rewinded = false;								// Whether the card has ever been rewinded

	full_note = '';		// The entire note on the card
	last_note = '';		// The most recent note on the card

	/**
     * @param {number} suitIndex
     * @param {number} rank
     * @param {Partial<Card>} additions
     */
	constructor(suitIndex, rank, additions = {}) {
		/** @type {number} */
		this.suitIndex = suitIndex;
		/** @type {number} */
		this.rank = rank;

		Object.assign(this, additions);
	}

	/**
	 * Creates a deep copy of the card.
	 */
	clone() {
		const new_card = new Card(this.suitIndex, this.rank, this);

		for (const field of ['possible', 'inferred']) {
			new_card[field] = [];
			for (const card of this[field]) {
				new_card[field].push(new Card(card.suitIndex, card.rank));
			}
		}

		for (const field of ['clues', 'reasoning', 'reasoning_turn']) {
			new_card[field] = [];
			for (const obj of this[field]) {
				new_card[field].push(JSON.parse(JSON.stringify(obj)));
			}
		}
		return new_card;
	}

	/**
	 * Returns the identity of the card (if known/inferred).
	 * 
	 * If the 'symmetric' option is enabled, asymmetric information (i.e. seeing the card) is not used.
	 * 
	 * If the 'infer' option is enabled, the card's inferences are used to determine its identity (as a last option).
	 * @param {MatchOptions} options
	 */
	identity(options = {}) {
		if (this.possible?.length === 1) {
			return this.possible[0];
		}
		else if (!options.symmetric && this.suitIndex !== -1) {
			return this;
		}
		else if (options.infer && this.inferred?.length === 1) {
			return this.inferred[0];
		}
		return;
	}

	/**
	 * Checks if the card matches the provided suitIndex and rank.
     * @param {number} suitIndex
     * @param {number} rank
     * @param {MatchOptions} options
     */
	matches(suitIndex, rank, options = {}) {
		const id = this.identity(options);

		if (id === undefined) {
			return false;
		}

		return id.suitIndex === suitIndex && id.rank === rank;
	}

	/**
	 * Returns whether one of the card's inferences matches its actual suitIndex and rank.
	 * Returns true if the card has only 1 possibility or the card is unknown (i.e. in our hand). 
	 */
	matches_inferences() {
		return this.suitIndex === -1 || this.possible.length === 1 || this.inferred.some(c => c.matches(this.suitIndex, this.rank));
	}

	/**
	 * Sets the inferences/possibilities to the intersection of the existing field and the provided array of cards.
     * @param {'possible' | 'inferred'} type
     * @param {BasicCard[]} cards
     */
	intersect(type, cards) {
		this[type] = this[type].filter(c1 => cards.some(c2 => c1.matches(c2.suitIndex, c2.rank)));
	}

	/**
	 * Sets the inferences/possibilities to the difference of the existing field and the provided array of cards.
     * @param {'possible' | 'inferred'} type
     * @param {BasicCard[]} cards
     */
	subtract(type, cards) {
		this[type] = this[type].filter(c1 => !cards.some(c2 => c1.matches(c2.suitIndex, c2.rank)));
	}

	/**
	 * Sets the inferences/possibilities to the union of the existing field and the provided array of cards.
     * @param {'possible' | 'inferred'} type
     * @param {Card[]} cards
     */
	union(type, cards) {
		for (const card of cards) {
			if (!this[type].some(c => c.matches(card.suitIndex, card.rank))) {
				this[type].push(card);
			}
		}
	}
}
