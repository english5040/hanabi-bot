import { Card } from './basics/Card.js';
import { find_possibilities } from './basics/helper.js';
import { visibleFind } from './basics/hanabi-util.js';
import { cardCount } from './variants.js';
import logger from './tools/logger.js';
import { logCard } from './tools/log.js';
import * as Utils from './tools/util.js';

/**
 * @typedef {import('./basics/State.js').State} State
 * @typedef {import('./types.js').ClueAction} ClueAction
 * @typedef {import('./types.js').DiscardAction} DiscardAction
 * @typedef {import('./types.js').CardAction} DrawAction
 * @typedef {import('./types.js').PlayAction} PlayAction
 */

/**
 * @param {State} state
 * @param {ClueAction} action
 */
export function onClue(state, action) {
	const { target, clue, list } = action;
	const new_possible = find_possibilities(clue, state.suits);

	for (const card of state.hands[target]) {
		if (list.includes(card.order)) {
			const inferences_before = card.inferred.length;
			card.intersect('possible', new_possible);
			card.intersect('inferred', new_possible);

			if (!card.clued) {
				card.newly_clued = true;
				card.clued = true;
			}
			card.clues.push(clue);
			if (card.inferred.length < inferences_before) {
				card.reasoning.push(state.actionList.length - 1);
				card.reasoning_turn.push(state.turn_count);
			}
		}
		else {
			card.subtract('possible', new_possible);
			card.subtract('inferred', new_possible);
		}

		// Eliminate in own hand (no one has eliminated this card yet since we just learned about it)
		if (card.possible.length === 1) {
			card_elim(state, card.possible[0].suitIndex, card.possible[0].rank);
		}
	}

	state.clue_tokens--;
}

/**
 * @param {State} state
 * @param {DiscardAction} action
 */
export function onDiscard(state, action) {
	const { failed, order, playerIndex, rank, suitIndex } = action;
	state.hands[playerIndex].removeOrder(order);

	state.discard_stacks[suitIndex][rank - 1]++;
	card_elim(state, suitIndex, rank);

	// Discarded all copies of a card - the new max rank is 1 less than the rank of discarded card
	if (state.discard_stacks[suitIndex][rank - 1] === cardCount(state.suits[suitIndex], rank) && state.max_ranks[suitIndex] > rank - 1) {
		state.max_ranks[suitIndex] = rank - 1;
	}

	if (failed) {
		state.strikes++;
	}

	// Bombs count as discards, but they don't give a clue token
	if (!failed && state.clue_tokens < 8) {
		state.clue_tokens++;
	}
}

/**
 * @param {State} state
 * @param {DrawAction} action
 */
export function onDraw(state, action) {
	const { order, playerIndex, suitIndex, rank } = action;
	const card = new Card(suitIndex, rank, {
		order,
		possible: Utils.objClone(state.all_possible[playerIndex]),
		inferred: Utils.objClone(state.all_possible[playerIndex]),
		drawn_index: state.actionList.length
	});
	state.hands[playerIndex].unshift(card);

	// Don't eliminate if we drew the card (since we don't know what it is)
	if (playerIndex !== state.ourPlayerIndex) {
		card_elim(state, suitIndex, rank, [playerIndex]);
	}

	state.cardsLeft--;

	// suitIndex and rank are -1 if they're your own cards
}

/**
 * @param {State} state
 * @param {PlayAction} action
 */
export function onPlay(state, action) {
	const { order, playerIndex, rank, suitIndex } = action;
	state.hands[playerIndex].removeOrder(order);

	state.play_stacks[suitIndex] = rank;
	card_elim(state, suitIndex, rank);

	// Get a clue token back for playing a 5
	if (rank === 5 && state.clue_tokens < 8) {
		state.clue_tokens++;
	}
}

/**
 * @param {State} state
 * @param {number} suitIndex
 * @param {number} rank
 * @param {number[]} [ignorePlayerIndexes]
 */
export function card_elim(state, suitIndex, rank, ignorePlayerIndexes = []) {
	for (let playerIndex = 0; playerIndex < state.numPlayers; playerIndex++) {
		if (ignorePlayerIndexes.includes(playerIndex)) {
			continue;
		}

		// Skip if already eliminated
		if (!state.all_possible[playerIndex].some(c => c.matches(suitIndex, rank))) {
			continue;
		}

		const base_count = state.discard_stacks[suitIndex][rank - 1] + (state.play_stacks[suitIndex] >= rank ? 1 : 0);
		const certain_count = base_count + visibleFind(state, playerIndex, suitIndex, rank, { infer: false }).length;
		const inferred_count = base_count + visibleFind(state, playerIndex, suitIndex, rank).length;
		const total_count = cardCount(state.suits[suitIndex], rank);

		// Note that inferred_count >= certain_count.
		// If all copies of a card are already visible (or there exist too many copies)
		if (inferred_count >= total_count) {
			// Remove it from the list of future possibilities
			state.all_possible[playerIndex] = state.all_possible[playerIndex].filter(c => !c.matches(suitIndex, rank));

			for (const card of state.hands[playerIndex]) {
				// All cards are known accounted for, so eliminate on all cards that are not known
				if (certain_count === total_count) {
					if (!card.matches(suitIndex, rank, { symmetric: true })) {
						card.subtract('possible', [{suitIndex, rank}]);
						card.subtract('inferred', [{suitIndex, rank}]);
					}
				}
				// All cards are inferred accounted for, so eliminate on all cards that are not inferred
				else if (inferred_count === total_count) {
					if (!card.matches(suitIndex, rank, { symmetric: true, infer: true })) {
						card.subtract('inferred', [{suitIndex, rank}]);
					}
				}
				// There is an extra inference somewhere, and not enough known cards
				else if (inferred_count > total_count) {
					logger.error(`inferred ${inferred_count} copies of ${logCard({suitIndex, rank})}`);
					// TODO: There was a lie somewhere, waiting for fix? Or can deduce from focus?
					break;
				}
			}
			logger.debug(`removing ${logCard({suitIndex, rank})} from ${state.playerNames[playerIndex]}'s hand and future possibilities`);
		}
	}
}
