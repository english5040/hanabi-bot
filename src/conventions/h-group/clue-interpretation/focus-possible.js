import { CLUE } from '../../../constants.js';
import { determine_focus } from '../hanabi-logic.js';
import { find_connecting } from './connecting-cards.js';
import { isCritical, playableAway, visibleFind } from '../../../basics/hanabi-util.js';
import logger from '../../../tools/logger.js';
import { logCard } from '../../../tools/log.js';
import * as Utils from '../../../tools/util.js';

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../../types.js').ClueAction} ClueAction
 * @typedef {import('../../../types.js').Connection} Connection
 * 
 * @typedef FocusPossibility
 * @property {number} suitIndex
 * @property {number} rank
 * @property {Connection[]} connections
 * @property {boolean} [save]
 */

/**
 * Returns all the valid focus possibilities of the focused card from a clue of the given colour.
 * @param {State} state
 * @param {number} suitIndex
 * @param {ClueAction} action
 */
function find_colour_focus(state, suitIndex, action) {
	const { giver, list, target } = action;
	const { focused_card, chop } = determine_focus(state.hands[target], list);

	/** @type {FocusPossibility[]} */
	const focus_possible = [];
	let next_playable_rank = state.play_stacks[suitIndex] + 1;

	// Play clue
	/** @type {Connection[]} */
	let connections = [];

	// Try looking for a connecting card (other than itself)
	const hypo_state = state.minimalCopy();
	let already_connected = [focused_card.order];

	let finesses = 0;

	while (next_playable_rank < state.max_ranks[suitIndex]) {
		// Note that a colour clue always looks direct
		const ignoreOrders = already_connected.concat(state.next_ignore[next_playable_rank - state.play_stacks[suitIndex] - 1] ?? []);
		const looksDirect = focused_card.identity({ symmetric: true }) === undefined;
		const connecting = find_connecting(hypo_state, giver, target, suitIndex, next_playable_rank, looksDirect, ignoreOrders);
		if (connecting.length === 0) {
			break;
		}

		const { type, card } = connecting[0];

		if (type === 'known' && card.newly_clued && card.possible.length > 1 && focused_card.inferred.some(c => c.matches(suitIndex, next_playable_rank))) {
			// Trying to use a newly 'known' connecting card, but the focused card could be that
			// e.g. If 2 reds are clued with only r5 remaining, the focus should not connect to the other card as r6
			logger.warn(`blocked connection - focused card could be ${logCard({suitIndex, rank: next_playable_rank})}`);
			break;
		}
		else if (type === 'finesse') {
			finesses++;
			if (state.level === 1 && finesses === 2) {
				logger.warn('blocked double finesse at level 1');
				break;
			}

			// Even if a finesse is possible, it might not be a finesse
			focus_possible.push({ suitIndex, rank: next_playable_rank, save: false, connections: Utils.objClone(connections) });
		}
		hypo_state.play_stacks[suitIndex]++;
		next_playable_rank++;

		connections = connections.concat(connecting);
		already_connected = already_connected.concat(connecting.map(conn => conn.card.order));
	}

	// Our card could be the final rank that we can't find
	focus_possible.push({ suitIndex, rank: next_playable_rank, save: false, connections });

	// Save clue on chop (5 save cannot be done with colour)
	if (chop) {
		for (let rank = state.play_stacks[suitIndex] + 1; rank <= Math.min(state.max_ranks[suitIndex], 4); rank++) {
			// Determine if possible save on k2, k5 with colour
			if (state.suits[suitIndex] === 'Black' && (rank === 2 || rank === 5)) {
				let fill_ins = 0;

				for (const card of state.hands[target]) {
					if (!list.includes(card.order)) {
						continue;
					}

					if (card.newly_clued ||
						card.clues.some((clue, index) => index !== card.clues.length - 1 && Utils.objEquals(clue, card.clues.at(-1)))
					) {
						fill_ins++;
					}
				}

				// Only touched/filled in 1 new card
				if (fill_ins < 2) {
					continue;
				}
			}

			// Check if card is critical
			if (isCritical(state, suitIndex, rank)) {
				focus_possible.push({ suitIndex, rank, save: true, connections: [] });
			}
		}
	}
	return focus_possible;
}

/**
 * Returns all the valid focus possibilities of the focused card from a clue of the given rank.
 * @param {State} state
 * @param {number} rank
 * @param {ClueAction} action
 */
function find_rank_focus(state, rank, action) {
	const { giver, list, target } = action;
	const { focused_card, chop } = determine_focus(state.hands[target], list);

	/** @type {FocusPossibility[]} */
	const focus_possible = [];
	let looksSave = false, alwaysSave = false;

	// Save clue on chop
	if (chop) {
		for (let suitIndex = 0; suitIndex < state.suits.length; suitIndex++) {
			// Don't need to consider save on playable cards
			if (playableAway(state, suitIndex, rank) === 0) {
				continue;
			}

			// Don't consider save on k3, k4 with rank
			if (state.suits[suitIndex] === 'Black' && (rank === 3 || rank === 4)) {
				continue;
			}

			// Looks like a 2 save on any 2 not known to target
			const find_opts = { infer: [target, giver, state.ourPlayerIndex], symmetric: [target, giver] };
			const save2 = rank === 2 && visibleFind(state, target, suitIndex, 2, find_opts).filter(c => c.order !== focused_card.order).length === 0;

			// Critical save or 2 save
			if (isCritical(state, suitIndex, rank) || save2) {
				// Saving 2s or 5s will never cause a prompt or finesse.
				if (save2 || rank === 5) {
					alwaysSave = true;
				}
				focus_possible.push({ suitIndex, rank, save: true, connections: [] });
				looksSave = true;
			}
		}
	}

	if (alwaysSave) {
		return focus_possible;
	}

	// Play clue
	for (let suitIndex = 0; suitIndex < state.suits.length; suitIndex++) {
		// Critical cards can never be given a play clue
		if (isCritical(state, suitIndex, rank)) {
			continue;
		}

		let next_rank = state.play_stacks[suitIndex] + 1;

		/** @type {Connection[]} */
		let connections = [];

		if (rank === next_rank) {
			focus_possible.push({ suitIndex, rank, save: false, connections });
		}
		else if (rank > next_rank) {
			// Try looking for all connecting cards
			const hypo_state = state.minimalCopy();
			let already_connected = [focused_card.order];

			let finesses = 0;

			const looksPlayable = state.hypo_stacks[giver].some(stack => stack + 1 === rank);
			let ignoreOrders = already_connected.concat(state.next_ignore[next_rank - state.play_stacks[suitIndex] - 1] ?? []);
			let looksDirect = focused_card.identity({ symmetric: true }) === undefined && (looksSave || looksPlayable);
			let connecting = find_connecting(hypo_state, giver, target, suitIndex, next_rank, looksDirect, ignoreOrders);

			while (connecting.length !== 0) {
				const { type, card } = connecting[0];

				if (card.newly_clued && card.possible.length > 1 && focused_card.inferred.some(c => c.matches(suitIndex, next_rank))) {
					// Trying to use a newly known/playable connecting card, but the focused card could be that
					// e.g. If two 4s are clued (all other 4s visible), the other 4 should not connect and render this card with only one inference
					logger.warn(`blocked connection - focused card could be ${logCard({suitIndex, rank: next_rank})}`);
					break;
				}

				finesses += connecting.filter(conn => conn.type === 'finesse').length;
				if (state.level === 1 && finesses === 2) {
					logger.warn('blocked double finesse at level 1');
					break;
				}

				if (type === 'finesse') {
					// A finesse proves that this is not direct
					looksDirect = focused_card.identity({ symmetric: true }) === undefined && looksSave;

					if (rank === next_rank) {
						// Even if a finesse is possible, it might not be a finesse
						focus_possible.push({ suitIndex, rank, save: false, connections: Utils.objClone(connections) });
					}
				}

				connections = connections.concat(connecting);
				already_connected = already_connected.concat(connecting.map(conn => conn.card.order));

				next_rank++;
				hypo_state.play_stacks[suitIndex]++;

				if (next_rank > rank) {
					logger.warn('stacked beyond clued rank, deciding to ignore possibility');
					break;
				}

				ignoreOrders = already_connected.concat(state.next_ignore[next_rank - state.play_stacks[suitIndex] - 1] ?? []);
				connecting = find_connecting(hypo_state, giver, target, suitIndex, next_rank, looksDirect, ignoreOrders);
			}

			// Connected cards can stack up to this rank
			if (rank === next_rank) {
				focus_possible.push({ suitIndex, rank, save: false, connections });
			}
		}
	}
	return focus_possible;
}

/**
 * Finds all the valid focus possibilities from the given clue.
 * @param {State} state
 * @param {ClueAction} action
 */
export function find_focus_possible(state, action) {
	const { clue } = action;
	logger.debug('play/hypo/max stacks in clue interpretation:', state.play_stacks, state.hypo_stacks, state.max_ranks);

	/** @type {FocusPossibility[]} */
	let focus_possible = [];

	if (clue.type === CLUE.COLOUR) {
		const colour = state.suits.includes('Rainbow') ? state.suits.indexOf('Rainbow') : clue.value;
		focus_possible = focus_possible.concat(find_colour_focus(state, colour, action));
	}
	else {
		// Pink promise assumed
		focus_possible = focus_possible.concat(find_rank_focus(state, clue.value, action));
	}

	if (state.suits.includes('Omni')) {
		focus_possible = focus_possible.concat(find_colour_focus(state, state.suits.indexOf('Omni'), action));
	}

	// Remove earlier duplicates (since save overrides play)
	return focus_possible.filter((p1, index1) => {
		return !focus_possible.some((p2, index2) => p1.suitIndex === p2.suitIndex && p1.rank === p2.rank && index1 < index2);
	});
}
