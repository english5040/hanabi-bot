import { CLUE } from '../../../constants.js';
import { LEVEL } from '../h-constants.js';
import { Card } from '../../../basics/Card.js';
import { interpret_tcm, interpret_5cm } from './interpret-cm.js';
import { stalling_situation } from './interpret-stall.js';
import { determine_focus } from '../hanabi-logic.js';
import { find_focus_possible } from './focus-possible.js';
import { find_own_finesses } from './connecting-cards.js';
import { bad_touch_possibilities, update_hypo_stacks, recursive_elim } from '../../../basics/helper.js';
import { isBasicTrash, isTrash, playableAway, visibleFind } from '../../../basics/hanabi-util.js';
import { cardCount } from '../../../variants.js';

import logger from '../../../tools/logger.js';
import * as Basics from '../../../basics.js';
import { logCard, logHand } from '../../../tools/log.js';
import * as Utils from '../../../tools/util.js';

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../../types.js').ClueAction} ClueAction
 * @typedef {import('../../../types.js').Connection} Connection
 */


/**
 * @param {State} state
 * @param {number} playerIndex
 * @param {number} suitIndex
 * @param {number} rank
 */
function infer_elim(state, playerIndex, suitIndex, rank) {
	// We just learned about the card
	if (playerIndex === state.ourPlayerIndex) {
		for (let i = 0; i < state.numPlayers; i++) {
			Basics.card_elim(state, i, suitIndex, rank);
		}
	}
	// Everyone already knew about the card except the person who drew it
	else {
		Basics.card_elim(state, playerIndex, suitIndex, rank);
	}
}

/**
 * Given a clue, recursively applies good touch principle to the target's hand.
 * @param {State} state
 * @param {ClueAction} action
 * @returns {{fix?: boolean, layered_reveal?: boolean}} Possible results of the clue.
 */
function apply_good_touch(state, action) {
	const { giver, list, target } = action;
	let fix = false;

	// Keep track of all cards that previously had inferences (i.e. not known trash)
	const had_inferences = state.hands[target].filter(card => card.inferred.length > 0).map(card => {
		return { inferences: card.inferred.length, order: card.order };
	});

	Basics.onClue(state, action);

	// Check all cards if inferences were reduced to 1 and elim if so (unless basics already performed elim)
	for (const card of state.hands[target]) {
		if (card.inferred.length === 1 && card.possible.length > 1) {
			const old_card = had_inferences.find(({ order }) => order === card.order);

			if (old_card.inferences > 1) {
				infer_elim(state, target, card.inferred[0].suitIndex, card.inferred[0].rank);
			}
		}
	}

	// Check if a layered finesse was revealed on us
	if (target === state.ourPlayerIndex) {
		for (const card of state.hands[target]) {
			if (card.finessed && had_inferences.some(({ order }) => order === card.order) && card.inferred.length === 0) {
				// TODO: Possibly try rewinding older reasoning until rewind works?
				const action_index = list.includes(card.order) ? card.reasoning.at(-2) : card.reasoning.pop();
				if (state.rewind(action_index, { type: 'finesse', list, clue: action.clue })) {
					return { layered_reveal: true };
				}
			}
		}
	}

	// Touched cards should also obey good touch principle
	let bad_touch = bad_touch_possibilities(state, giver, target);
	let bad_touch_len;

	// Recursively deduce information until no new information is learned
	do {
		bad_touch_len = bad_touch.length;
		const reduced_inferences = [];

		for (const card of state.hands[target]) {
			if (card.inferred.length > 1 && (card.clued || card.chop_moved)) {
				card.subtract('inferred', bad_touch);
				reduced_inferences.push(card);
			}
		}

		for (const card of reduced_inferences) {
			if (card.inferred.length === 1) {
				infer_elim(state, target, card.inferred[0].suitIndex, card.inferred[0].rank);
			}
		}

		for (const card of state.hands[target]) {
			// Check for fix on retouched cards
			if (list.includes(card.order) && !card.newly_clued) {
				// Lost all inferences, revert to good touch principle (must not have been known trash)
				if (card.inferred.length === 0 && had_inferences.some(({ order }) => order === card.order) && !card.reset) {
					fix = true;
					card.inferred = Utils.objClone(card.possible);
					card.subtract('inferred', bad_touch);
					card.reset = true;
					continue;
				}
				// Directly revealing a duplicated card in someone else's hand (if we're using an inference, the card must match the inference, unless it's unknown)
				else if (card.possible.length === 1) {
					const { suitIndex, rank } = card.possible[0];

					// The fix can be in anyone's hand except the giver's
					fix = state.hands.some((hand, index) =>
						index !== giver && hand.some(c => (c.clued || c.finessed) && c.matches(suitIndex, rank, { infer: true }) && c.order !== card.order)
					);
				}
			}
		}

		state.hands[target].refresh_links();

		bad_touch = bad_touch_possibilities(state, giver, target, bad_touch);
	}
	while (bad_touch_len !== bad_touch.length);

	logger.debug('bad touch', bad_touch.map(c => logCard(c)).join(','));
	return { fix };
}

/**
 * Interprets the given clue. First tries to look for inferred connecting cards, then attempts to find prompts/finesses.
 * @param {State} state
 * @param {ClueAction} action
 */
export function interpret_clue(state, action) {
	const prev_state = state.minimalCopy();

	const { clue, giver, list, target, mistake = false, ignoreStall = false } = action;
	const { focused_card, chop } = determine_focus(state.hands[target], list, { beforeClue: true });

	const old_focused = focused_card.focused;
	focused_card.focused = true;

	const { fix, layered_reveal } = apply_good_touch(state, action);

	// Rewind occurred, this action will be completed as a result of it
	if (layered_reveal) {
		return;
	}

	if (chop) {
		focused_card.chop_when_first_clued = true;
	}

	if (focused_card.inferred.length === 0) {
		focused_card.inferred = Utils.objClone(focused_card.possible);
		logger.warn('focused card had no inferences after applying good touch');
	}

	logger.debug('pre-inferences', focused_card.inferred.map(c => logCard(c)).join());

	if ((state.level >= LEVEL.FIX && fix) || mistake) {
		logger.info(`${fix ? 'fix clue' : 'mistake'}! not inferring anything else`);
		// FIX: Rewind to when the earliest card was clued so that we don't perform false eliminations
		if (focused_card.inferred.length === 1) {
			const { suitIndex, rank } = focused_card.inferred[0];
			update_hypo_stacks(state);

			// TODO: Revise, should we always hard elim?
			team_elim(state, focused_card, giver, target, suitIndex, rank);
		}

		// Focus doesn't matter for a fix clue
		focused_card.focused = old_focused;
		return;
	}

	// Check if the giver was in a stalling situation
	if (!ignoreStall && stalling_situation(state, action, prev_state)) {
		logger.info('stalling situation');
		update_hypo_stacks(state);
		return;
	}

	// Check for chop moves at level 4+
	if (state.level >= LEVEL.BASIC_CM) {
		// Trash chop move
		if (focused_card.newly_clued &&
			focused_card.possible.every(c => isTrash(state, target, c.suitIndex, c.rank, focused_card.order, { infer: [] })) &&
			!(focused_card.inferred.every(c => playableAway(state, c.suitIndex, c.rank) === 0))
		) {
			interpret_tcm(state, target);
			return;
		}
		// 5's chop move - for now, 5cm cannot be done in early game.
		else if (clue.type === CLUE.RANK && clue.value === 5 && focused_card.newly_clued && !state.early_game) {
			if (interpret_5cm(state, target)) {
				return;
			}
		}
	}

	const focus_possible = find_focus_possible(state, action);
	logger.info('focus possible:', focus_possible.map(({ suitIndex, rank, save, connections }) => {
		return {
			identity: logCard({suitIndex, rank}),
			save,
			conn: connections.map(({ type, reacting, card }) => {
				return JSON.stringify({ type, reacting: state.playerNames[reacting], card: logCard(card) });
			})
		};
	}));

	const matched_inferences = focus_possible.filter(p => focused_card.inferred.some(c => c.matches(p.suitIndex, p.rank)));
	const matched_correct = target === state.ourPlayerIndex || matched_inferences.some(p => focused_card.matches(p.suitIndex, p.rank));

	// Card matches an inference and not a save/stall
	// If we know the identity of the card, one of the matched inferences must also be correct before we can give this clue.
	if (matched_inferences.length >= 1 && matched_correct) {
		focused_card.intersect('inferred', focus_possible);

		for (const inference of matched_inferences) {
			const { suitIndex, rank, connections, save = false } = inference;

			if (!save) {
				if ((target === state.ourPlayerIndex || focused_card.matches(suitIndex, rank))) {
					assign_connections(state, connections, suitIndex);
				}

				// Multiple inferences, we need to wait for connections
				if (connections.length > 0 && connections.some(conn => ['prompt', 'finesse'].includes(conn.type))) {
					state.waiting_connections.push({ connections, focused_card, inference: { suitIndex, rank }, giver, action_index: this.actionList.length - 1 });
				}
			}

			// Only one inference, we can update hypo stacks
			if (matched_inferences.length === 1 && (connections.length === 0 || !['prompt', 'finesse'].includes(connections[0].type))) {
				team_elim(state, focused_card, giver, target, suitIndex, rank);
			}
		}
	}
	// Card doesn't match any inferences
	else {
		logger.info(`card ${logCard(focused_card)} order ${focused_card.order} doesn't match any inferences!`);

		/** @type {{connections: Connection[], conn_suit: number}[]} */
		const all_connections = [];
		logger.info(`inferences ${focused_card.inferred.map(c => logCard(c)).join(',')}`);

		if (target === state.ourPlayerIndex) {
			// Only look for finesses if the card isn't trash
			if (focused_card.inferred.some(c => !isBasicTrash(state, c.suitIndex, c.rank))) {
				// We are the clue target, so we need to consider all the possibilities of the card
				let conn_save, min_blind_plays = state.hands[state.ourPlayerIndex].length + 1;
				let self = true;

				for (const card of focused_card.inferred) {
					if (isBasicTrash(state, card.suitIndex, card.rank)) {
						continue;
					}

					const looksDirect = focused_card.identity({ symmetric: true }) === undefined && (		// Focus must be unknown AND
						action.clue.type === CLUE.COLOUR ||												// Colour clue always looks direct
						state.hypo_stacks[giver].some(stack => stack + 1 === action.clue.value) ||		// Looks like a play
						focus_possible.some(fp => fp.save));											// Looks like a save

					const { feasible, connections } = find_own_finesses(state, giver, target, card.suitIndex, card.rank, looksDirect);
					const blind_plays = connections.filter(conn => conn.type === 'finesse').length;
					logger.info('feasible?', feasible, 'blind plays', blind_plays);

					if (feasible) {
						// Starts with self-finesse or self-prompt
						if (connections[0]?.self) {
							// TODO: This interpretation should always exist, but must wait for all players to ignore first
							if (self && blind_plays < min_blind_plays) {
								conn_save = { connections, conn_suit: card.suitIndex };
								min_blind_plays = blind_plays;
							}
						}
						// Doesn't start with self
						else {
							// Temp: if a connection with no self-component exists, don't consider any connection with a self-component
							self = false;
							all_connections.push({ connections, conn_suit: card.suitIndex });
						}
					}
				}

				if (self && conn_save !== undefined) {
					all_connections.push(conn_save);
				}
			}
		}
		// Someone else is the clue target, so we know exactly what card it is
		else if (!isBasicTrash(state, focused_card.suitIndex, focused_card.rank)) {
			const looksDirect = focused_card.identity({ symmetric: true }) === undefined && (	// Focused card must be unknown AND
				action.clue.type === CLUE.COLOUR ||												// Colour clue always looks direct
				state.hypo_stacks[giver].some(stack => stack + 1 === action.clue.value) ||		// Looks like a play
				focus_possible.some(fp => fp.save));											// Looks like a save

			const { feasible, connections } = find_own_finesses(state, giver, target, focused_card.suitIndex, focused_card.rank, looksDirect);
			if (feasible) {
				all_connections.push({ connections, conn_suit: focused_card.suitIndex });
			}
		}

		// No inference, but a finesse isn't possible
		if (all_connections.length === 0) {
			focused_card.reset = true;
			// If it's in our hand, we have no way of knowing what the card is - default to good touch principle
			if (target === state.ourPlayerIndex) {
				logger.info('no inference on card (self), defaulting to gtp - ', focused_card.inferred.map(c => logCard(c)));
			}
			// If it's not in our hand, we should adjust our interpretation to their interpretation (to know if we need to fix)
			// We must force a finesse?
			else {
				const saved_inferences = focused_card.inferred;
				focused_card.intersect('inferred', focus_possible);

				if (focused_card.inferred.length === 0) {
					focused_card.inferred = saved_inferences;
				}
				logger.info('no inference on card (other), looks like', focused_card.inferred.map(c => logCard(c)).join(','));
			}
		}
		else {
			focused_card.inferred = [];

			for (const { connections, conn_suit } of all_connections) {
				assign_connections(state, connections, conn_suit);
				const inference_rank = state.play_stacks[conn_suit] + 1 + connections.filter(conn => !conn.hidden).length;

				// Add inference to focused card
				focused_card.union('inferred', [new Card(conn_suit, inference_rank)]);

				// Only one set of connections (and without prompt/finesse), so can elim safely
				if (all_connections.length === 1 && (connections.length === 0 || !['prompt', 'finesse'].includes(connections[0].type))) {
					team_elim(state, focused_card, giver, target, conn_suit, inference_rank);
				}

				// Multiple possible sets, we need to wait for connections
				if (connections.length > 0  && connections.some(conn => ['prompt', 'finesse'].includes(conn.type))) {
					const inference = { suitIndex: conn_suit, rank: inference_rank };
					state.waiting_connections.push({ connections, focused_card, inference, giver, action_index: this.actionList.length - 1  });
				}
			}

			state.hands.forEach(hand => hand.forEach(card => card.superposition = false));
		}
	}
	logger.highlight('blue', 'final inference on focused card', focused_card.inferred.map(c => logCard(c)).join(','));
	logger.debug('hand state after clue', logHand(state.hands[target]));
	update_hypo_stacks(state);
}

/**
 * Eliminates the given suitIndex and rank on clued cards from the team, following good touch principle.
 * @param {State} state
 * @param {Card} focused_card
 * @param {number} giver 		The clue receiver. They can elim only if they know/infer the focused card's identity.
 * @param {number} target 		The clue giver. They cannot elim on any of their own clued cards.
 * @param {number} suitIndex
 * @param {number} rank
 */
function team_elim(state, focused_card, giver, target, suitIndex, rank) {
	for (let i = 0; i < state.numPlayers; i++) {
		// Giver cannot elim own cards unless all identities can be seen
		if (i === giver) {
			const count = state.discard_stacks[suitIndex][rank - 1] + (state.play_stacks[suitIndex] >= rank ? 1 : 0) + visibleFind(state, giver, suitIndex, rank).length;
			if (count < cardCount(state.suits[suitIndex], rank)) {
				continue;
			}
		}

		// Target can elim only if inference is known, everyone else can elim
		if (i !== target || focused_card.inferred.length === 1) {
			// Don't elim on the focused card, but hard elim every other card
			recursive_elim(state, i, suitIndex, rank, {ignore: [focused_card.order], hard: true });
		}
	}
}

/**
 * Helper function that applies the given connections on the given suit to the state (e.g. writing finesses).
 * @param {State} state
 * @param {Connection[]} connections
 * @param {number} suitIndex
 */
function assign_connections(state, connections, suitIndex) {
	let next_rank = state.play_stacks[suitIndex] + 1;
	const hypo_stacks = state.hypo_stacks.slice();

	for (const connection of connections) {
		const { type, reacting, hidden, card: conn_card, known } = connection;
		// The connections can be cloned, so need to modify the card directly
		const card = state.hands[reacting].findOrder(conn_card.order);

		logger.info(`connecting on ${logCard(conn_card)} order ${card.order} type ${type}`);

		// Save the old inferences in case the connection doesn't exist (e.g. not finesse)
		card.old_inferred = Utils.objClone(card.inferred);

		if (type === 'finesse') {
			card.finessed = true;
			card.finesse_index = state.actionList.length;
			card.hidden = hidden;
		}

		if (hidden) {
			const playable_identities = hypo_stacks[reacting].map((stack_rank, index) => { return { suitIndex: index, rank: stack_rank + 1 }; });
			card.intersect('inferred', playable_identities);

			// Temporarily force update hypo stacks so that layered finesses are written properly (?)
			if (card.identity() !== undefined) {
				const { suitIndex: suitIndex2, rank: rank2 } = card.identity();
				if (hypo_stacks[reacting][suitIndex2] + 1 !== rank2) {
					logger.warn('trying to connect', logCard({ suitIndex: suitIndex2, rank: rank2 }), 'but hypo stacks at', hypo_stacks[suitIndex2]);
				}
				hypo_stacks[reacting][suitIndex2] = rank2;
			}
		}
		else {
			// There are multiple possible connections on this card
			if (card.superposition) {
				card.union('inferred', [new Card(suitIndex, next_rank)]);
			}
			else {
				if (!(type === 'playable' && !known)) {
					card.inferred = [new Card(suitIndex, next_rank)];
				}
				card.superposition = true;
			}
			next_rank++;
		}

		// Updating notes not on our turn
		// There might be multiple possible inferences on the same card from a self component
		// TODO: Examine why this originally had self only?
		if (card.old_inferred.length > card.inferred.length && card.reasoning.at(-1) !== state.actionList.length - 1) {
			card.reasoning.push(state.actionList.length - 1);
			card.reasoning_turn.push(state.turn_count);
		}
	}
}
