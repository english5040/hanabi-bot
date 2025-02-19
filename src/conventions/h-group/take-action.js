import { ACTION } from '../../constants.js';
import { CLUE } from '../../constants.js';
import { LEVEL } from './h-constants.js';
import { select_play_clue, find_urgent_actions, determine_playable_card, order_1s } from './action-helper.js';
import { find_clues } from './clue-finder/clue-finder.js';
import { inEndgame, minimum_clue_value } from './hanabi-logic.js';
import { cardValue, getPace, isTrash, visibleFind } from '../../basics/hanabi-util.js';
import logger from '../../tools/logger.js';
import { logCard, logClue, logHand, logPerformAction } from '../../tools/log.js';
import * as Utils from '../../tools/util.js';

/**
 * @typedef {import('../h-group.js').default} State
 * @typedef {import('../h-hand.js').HGroup_Hand} Hand
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

/**
 * Performs the most appropriate action given the current state.
 * @param {State} state
 * @return {PerformAction}
 */
export function take_action(state) {
	const { tableID } = state;
	const hand = state.hands[state.ourPlayerIndex];
	const { play_clues, save_clues, fix_clues, stall_clues } = find_clues(state);

	// Look for playables, trash and important discards in own hand
	let playable_cards = hand.find_playables();
	let trash_cards = state.hands[state.ourPlayerIndex].find_known_trash().filter(c => c.clued);

	const discards = [];
	for (const card of playable_cards) {
		const id = card.identity({ infer: true });

		// Skip non-trash cards and cards we don't know the identity of
		if (!trash_cards.some(c => c.order === card.order) || id === undefined) {
			continue;
		}

		// If there isn't a matching playable card in our hand, we should discard it to sarcastic for someone else
		if (!playable_cards.some(c => c.matches(id.suitIndex, id.rank, { infer: true }) && c.order !== card.order)) {
			discards.push(card);
		}
	}

	// Remove trash cards from playables and discards from trash cards
	playable_cards = playable_cards.filter(pc => !trash_cards.some(tc => tc.order === pc.order));
	trash_cards = trash_cards.filter(tc => !discards.some(dc => dc.order === tc.order));

	if (playable_cards.length > 0) {
		logger.info('playable cards', logHand(playable_cards));
	}
	if (trash_cards.length > 0) {
		logger.info('trash cards', logHand(trash_cards));
	}
	if (discards.length > 0) {
		logger.info('discards', logHand(discards));
	}

	const playable_priorities = determine_playable_card(state, playable_cards);
	const urgent_actions = find_urgent_actions(state, play_clues, save_clues, fix_clues, playable_priorities);

	if (urgent_actions.some(actions => actions.length > 0)) {
		logger.info('all urgent actions', urgent_actions.map((actions, index) => actions.map(action => { return { [index]: logPerformAction(action) }; })).flat());
	}

	let priority = playable_priorities.findIndex(priority_cards => priority_cards.length > 0);

	/** @type {Card} */
	let best_playable_card;
	if (priority !== -1) {
		best_playable_card = playable_priorities[priority][0];

		// Best playable card is an unknown 1, so we should order correctly
		if (best_playable_card.clues.length > 0 && best_playable_card.clues.every(clue => clue.type === CLUE.RANK && clue.value === 1)) {
			const ordered_1s = order_1s(state, playable_cards);
			if (ordered_1s.length > 0) {
				let best_ocm_index = 0, best_ocm_value = -0.1;

				// Try to find a non-negative value OCM
				for (let i = 1; i < ordered_1s.length; i++) {
					const playerIndex = (state.ourPlayerIndex + i) % state.numPlayers;

					if (playerIndex === state.ourPlayerIndex) {
						break;
					}

					const old_chop = state.hands[playerIndex].chop();
					// Player is locked, OCM is meaningless
					if (old_chop === undefined) {
						continue;
					}
					const old_chop_value = cardValue(state, old_chop);

					const newHand = state.hands[playerIndex].clone();
					newHand.chop().chop_moved = true;
					const new_chop_value = newHand.chopValue();

					const ocm_value = old_chop_value - new_chop_value;
					const { suitIndex, rank, order } = old_chop;

					if (!isTrash(state, state.ourPlayerIndex, suitIndex, rank, order) && ocm_value > best_ocm_value) {
						best_ocm_index = i;
						best_ocm_value = ocm_value;
					}
				}
				best_playable_card = ordered_1s[best_ocm_index];
			}
		}

		if (state.level >= LEVEL.INTERMEDIATE_FINESSES) {
			while (priority === 0 && hand.some(c => c.finessed && c.finesse_index < best_playable_card.finesse_index)) {
				logger.warn('older finesse could be layered, unable to play newer finesse', logCard(best_playable_card));

				// Remove from playable cards
				playable_priorities[priority].splice(playable_priorities[priority].findIndex(c => c.order === best_playable_card.order), 1);
				playable_cards.splice(playable_cards.findIndex(c => c.order === best_playable_card.order), 1);

				// Find new best playable card
				priority = playable_priorities.findIndex(priority_cards => priority_cards.length > 0);
				if (priority !== -1) {
					best_playable_card = playable_priorities[priority][0];
				}
				else {
					best_playable_card = undefined;
				}
			}
		}

		if (priority !== -1) {
			logger.info(`best playable card is order ${best_playable_card.order}, inferences ${best_playable_card.inferred.map(c => logCard(c))}`);
		}
	}

	// Playing into finesse/bluff
	if (playable_cards.length > 0 && priority === 0) {
		return { tableID, type: ACTION.PLAY, target: best_playable_card.order };
	}

	// Unlock next player
	if (urgent_actions[0].length > 0) {
		return urgent_actions[0][0];
	}

	// Urgent save for next player
	if (state.clue_tokens > 0) {
		for (let i = 1; i < 4; i++) {
			const actions = urgent_actions[i];
			if (actions.length > 0) {
				return actions[0];
			}
		}
	}

	// Get a high value play clue
	let best_play_clue, clue_value;
	if (state.clue_tokens > 0) {
		const all_play_clues = play_clues.flat();
		({ clue: best_play_clue, clue_value } = select_play_clue(all_play_clues));

		if (best_play_clue?.result.finesses > 0) {
			return Utils.clueToAction(best_play_clue, tableID);
		}
	}

	// Sarcastic discard to someone else
	if (state.level >= LEVEL.SARCASTIC && discards.length > 0) {
		const { suitIndex, rank } = discards[0].identity({ infer: true });
		const duplicates = visibleFind(state, state.ourPlayerIndex, suitIndex, rank, { ignore: [state.ourPlayerIndex] }).filter(c => c.clued);

		// If playing reveals duplicates are trash, playing is better for tempo in endgame
		if (inEndgame(state) && duplicates.every(c => c.inferred.length === 0 || (c.inferred.length === 1 && c.inferred[0].matches(suitIndex, rank)))) {
			return { tableID, type: ACTION.PLAY, target: discards[0].order };
		}

		return { tableID, type: ACTION.DISCARD, target: discards[0].order };
	}

	// Unlock other player than next
	if (urgent_actions[4].length > 0) {
		return urgent_actions[4][0];
	}

	// Forced discard if next player is locked
	// TODO: Anxiety play
	const nextPlayerIndex = (state.ourPlayerIndex + 1) % state.numPlayers;
	if (state.clue_tokens === 0 && state.hands[nextPlayerIndex].isLocked()) {
		discard_chop(hand, tableID);
	}

	// Playing a connecting card or playing a 5
	if (playable_cards.length > 0 && priority <= 3) {
		return { tableID, type: ACTION.PLAY, target: best_playable_card.order };
	}

	// Discard known trash at high pace, low clues
	if (trash_cards.length > 0 && getPace(state) > state.numPlayers * 2 && state.clue_tokens <= 3) {
		return { tableID, type: ACTION.DISCARD, target: trash_cards[0].order };
	}

	// Playable card with any priority
	if (playable_cards.length > 0) {
		return { tableID, type: ACTION.PLAY, target: best_playable_card.order };
	}

	if (state.clue_tokens > 0) {
		for (let i = 5; i < 9; i++) {
			// Give play clue (at correct priority level)
			if (i === (state.clue_tokens > 1 ? 5 : 8) && best_play_clue !== undefined) {
				if (clue_value >= minimum_clue_value(state)) {
					return Utils.clueToAction(best_play_clue, state.tableID);
				}
				else {
					logger.info('clue too low value', logClue(best_play_clue), clue_value);
					stall_clues[1].push(best_play_clue);
				}
			}

			// Go through rest of actions in order of priority (except early save)
			if (i !== 8 && urgent_actions[i].length > 0) {
				return urgent_actions[i][0];
			}
		}
	}

	// Either there are no clue tokens or the best play clue doesn't meet MCVP

	// Discard known trash (no pace requirement)
	if (trash_cards.length > 0 && !inEndgame(state) && state.clue_tokens < 8) {
		return { tableID, type: ACTION.DISCARD, target: trash_cards[0].order };
	}

	// Early save
	if (state.clue_tokens > 0 && urgent_actions[8].length > 0) {
		return urgent_actions[8][0];
	}

	const best_stall_severity = stall_clues.findIndex(clues => clues.length > 0);

	// Stalling situations
	if (state.clue_tokens > 0 && best_stall_severity !== -1) {
		const best_stall_clue = Utils.clueToAction(stall_clues[best_stall_severity][0], state.tableID);

		// 8 clues or locked hand
		if (state.clue_tokens === 8) {
			return best_stall_clue;
		}

		// Locked hand
		if (state.hands[state.ourPlayerIndex].isLocked()) {
			return best_stall_clue;
		}

		// Endgame (and stalling is effective)
		if (inEndgame(state) && state.hypo_stacks[state.ourPlayerIndex].some((stack, index) => stack > state.play_stacks[index])) {
			logger.info('endgame stall');
			return best_stall_clue;
		}

		// Early game
		if (state.early_game && best_stall_severity === 0) {
			return best_stall_clue;
		}
	}

	// Discarding known trash is still preferable to chop
	if (trash_cards.length > 0) {
		return { tableID, type: ACTION.DISCARD, target: trash_cards[0].order };
	}

	return discard_chop(hand, tableID);
}

/**
 * Discards the card on chop from the hand.
 * @param {Hand} hand
 * @param {number} tableID
 */
function discard_chop(hand, tableID) {
	// Nothing else to do, so discard chop
	const discard = hand.chop() ?? hand.locked_discard();

	return { tableID, type: ACTION.DISCARD, target: discard.order };
}
