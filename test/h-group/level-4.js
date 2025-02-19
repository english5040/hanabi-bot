// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, expandShortCard, getRawInferences, setup } from '../test-utils.js';
import HGroup from '../../src/conventions/h-group.js';
import { ACTION, CLUE } from '../../src/constants.js';
import * as Utils from '../../src/tools/util.js';
import logger from '../../src/tools/logger.js';

import { find_clues } from '../../src/conventions/h-group/clue-finder/clue-finder.js';
import { take_action } from '../../src/conventions/h-group/take-action.js';
import { determine_playable_card, find_urgent_actions } from '../../src/conventions/h-group/action-helper.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('trash chop move', () => {
	it('will give a rank tcm for 1 card', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r1', 'b4']
		], 4);

		state.play_stacks = [2, 2, 2, 2, 2];

		const { save_clues } = find_clues(state);
		const bob_save = save_clues[PLAYER.BOB];

		assert(bob_save !== undefined);
		assert(bob_save.type === CLUE.RANK && bob_save.value === 1);
	});

	it('will give a rank tcm touching multiple trash cards', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'r1', 'b4']
		], 4);

		state.play_stacks = [2, 2, 2, 2, 2];

		const { save_clues } = find_clues(state);
		const bob_save = save_clues[PLAYER.BOB];

		assert(bob_save !== undefined);
		assert(bob_save.type === CLUE.RANK && bob_save.value === 1);
	});

	it('will not give a tcm if chop is trash', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'b4', 'g1']
		], 4);

		state.play_stacks = [2, 2, 2, 2, 2];

		const { save_clues } = find_clues(state);
		assert.equal(save_clues[PLAYER.BOB], undefined);
	});

	it('will not give a tcm if chop is a duplicated card', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'g4', 'g4']
		], 4);

		state.play_stacks = [2, 2, 2, 2, 2];

		const { save_clues } = find_clues(state);
		assert.equal(save_clues[PLAYER.BOB], undefined);
	});

	it('will not give a tcm if chop can be saved directly (critical)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'b1', 'r1', 'g5']
		], 4);

		state.play_stacks = [2, 2, 2, 2, 2];

		const { save_clues } = find_clues(state);
		assert.deepEqual(Utils.objPick(save_clues[PLAYER.BOB], ['type', 'value']), { type: CLUE.RANK, value: 5 });
	});

	it('will not give a tcm if chop can be saved directly (2 save)', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y4', 'g4', 'b1', 'r1', 'y2']
		], 4);

		state.play_stacks = [5, 0, 0, 2, 2];

		const { save_clues } = find_clues(state);
		assert.deepEqual(Utils.objPick(save_clues[PLAYER.BOB], ['type', 'value']), { type: CLUE.RANK, value: 2 });
	});

	it('will not give a tcm if a play can be given instead', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['y4', 'g4', 'b1', 'r1', 'y2']
		], 4);

		state.play_stacks = [5, 1, 0, 2, 2];
		state.hypo_stacks = Array(2).fill([5, 1, 0, 2, 2]);

		const { play_clues, save_clues, fix_clues } = find_clues(state);
		const playable_priorities = determine_playable_card(state, state.hands[PLAYER.ALICE].find_playables());
		const urgent_actions = find_urgent_actions(state, play_clues, save_clues, fix_clues, playable_priorities);
		assert.deepEqual(urgent_actions[1], []);
		assert.deepEqual(Utils.objPick(urgent_actions[2][0], ['type', 'value']), { type: ACTION.COLOUR, value: 1 });
	});
});

describe('giving order chop move', () => {
	it('will find an ocm to the next player', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r3', 'r5']
		], 4);

		// Bob clues Alice 1, touching slots 3 and 4.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [1, 2], target: PLAYER.ALICE });

		const our_hand = state.hands[state.ourPlayerIndex];

		const playable_priorities = determine_playable_card(state, [our_hand[2], our_hand[3]]);
		const { play_clues, save_clues, fix_clues } = find_clues(state);
		const urgent_actions = find_urgent_actions(state, play_clues, save_clues, fix_clues, playable_priorities);

		assert.equal(urgent_actions[1][0].type, ACTION.PLAY);
		assert.equal(urgent_actions[1][0].target, our_hand[2].order);
	});

	it('will find an ocm to cathy', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g3', 'r3', 'y3', 'y4', 'y4'],
			['r4', 'r4', 'g4', 'r3', 'r5'],
		], 4);

		// Bob clues Alice 1, touching slots 2, 3 and 4.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [1, 2, 3], target: PLAYER.ALICE });

		const our_hand = state.hands[PLAYER.ALICE];

		const playable_priorities = determine_playable_card(state, [our_hand[1], our_hand[2], our_hand[3]]);
		const { play_clues, save_clues, fix_clues } = find_clues(state);
		const urgent_actions = find_urgent_actions(state, play_clues, save_clues, fix_clues, playable_priorities);

		assert.equal(urgent_actions[5][0].type, ACTION.PLAY);
		assert.equal(urgent_actions[5][0].target, our_hand[1].order);
	});

	it('will not give an ocm putting a critical on chop', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r5', 'r5']
		], 4);

		// Bob clues Alice 1, touching slots 3 and 4.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [1, 2], target: PLAYER.ALICE });

		const { save_clues } = find_clues(state);
		assert.deepEqual(Utils.objPick(save_clues[PLAYER.BOB], ['type', 'value']), { type: CLUE.RANK, value: 5 });
	});

	it('will not ocm trash', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'g4', 'r1']
		], 4);

		state.play_stacks = [2, 0, 0, 0, 0];
		state.hypo_stacks = Array(2).fill([2, 0, 0, 0, 0]);

		// Bob clues Alice 1, touching slots 3 and 4.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [1, 2], target: PLAYER.ALICE });

		// Alice should not OCM the trash r1.
		const action = take_action(state);
		assert.deepEqual(Utils.objPick(action, ['type', 'target']), { type: ACTION.PLAY, target: 1 });
	});

	it('will ocm one card of an unsaved duplicate', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g5', 'g4', 'g4']
		], 4);

		// Bob clues Alice 1, touching slots 3 and 4.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.BOB, list: [1, 2], target: PLAYER.ALICE });

		// Alice should OCM 1 copy of g4.
		const action = take_action(state);
		assert.deepEqual(Utils.objPick(action, ['type', 'target']), { type: ACTION.PLAY, target: 2 });
	});

	it('will not ocm one card of a saved duplicate', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g3', 'g3', 'r2'],
			['g4', 'r3', 'y3', 'y3', 'r2']
		], 4);

		// Bob clues Cathy 2, touching r2
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 2 }, giver: PLAYER.BOB, list: [10], target: PLAYER.CATHY });
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.DONALD });

		// Cathy clues Alice 1, touching slots 2 and 3.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.CATHY, list: [1, 2], target: PLAYER.ALICE });

		// Alice should not OCM the copy of r2.
		const action = take_action(state);
		assert.deepEqual(Utils.objPick(action, ['type', 'target']), { type: ACTION.PLAY, target: 1 });
	});
});

describe('interpreting order chop move', () => {
	it('will interpret an ocm to the next player', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'b1', 'g1', 'r1', 'r5'],
			['y4', 'r4', 'g4', 'r4', 'b5']
		], 4);

		// Alice clues Bob 1, touching slots 2, 3 and 4.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.ALICE, list: [6, 7, 8], target: PLAYER.BOB });

		// Bob performs an ocm on Cathy.
		state.handle_action({ type: 'play', order: 7, playerIndex: PLAYER.BOB, suitIndex: COLOUR.GREEN, rank: 1 });

		// Cathy's slot 5 should be chop moved.
		assert.equal(state.hands[PLAYER.CATHY][4].chop_moved, true);
	});

	it('will interpret an ocm skipping a player', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b4', 'b1', 'g1', 'r1', 'r5'],
			['y4', 'r4', 'g4', 'r4', 'b5']
		], 4);

		// Cathy clues Alice 5, touching slot 5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 5 }, giver: PLAYER.CATHY, list: [0], target: PLAYER.ALICE });

		// Alice clues Bob 1, touching slots 2, 3 and 4.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.ALICE, list: [6, 7, 8], target: PLAYER.BOB });

		// Bob performs an ocm on Alice.
		state.handle_action({ type: 'play', order: 8, playerIndex: PLAYER.BOB, suitIndex: COLOUR.GREEN, rank: 1 });

		// Alice's slot 4 should be chop moved.
		assert.equal(state.hands[PLAYER.ALICE][3].chop_moved, true);
	});
});

describe('interpreting chop moves', () => {
	it('will interpret new focus correctly', () => {
		const state = setup(HGroup, [
				['xx', 'xx', 'xx', 'xx', 'xx'],
				['b4', 'b3', 'g3', 'r3', 'r5']
			], 4);

		// Alice's slots 4 and 5 are chop moved
		[3, 4].forEach(index => state.hands[PLAYER.ALICE][index].chop_moved = true);

		// Bob clues Alice purple, touching slots 2 and 5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.PURPLE }, giver: PLAYER.BOB, list: [0,3], target: PLAYER.ALICE });

		// Alice's slot 2 should be p1.
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][1]), ['p1'].map(expandShortCard));
	});

	it('will interpret only touching cm cards correctly', () => {
		const state = setup(HGroup, [
				['xx', 'xx', 'xx', 'xx', 'xx'],
				['b4', 'b3', 'g3', 'r3', 'r5']
			], 4);

		// Alice's slots 4 and 5 are chop moved
		[3, 4].forEach(index => state.hands[PLAYER.ALICE][index].chop_moved = true);

		// Bob clues Alice purple, touching slots 4 and 5.
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.PURPLE }, giver: PLAYER.BOB, list: [0,1], target: PLAYER.ALICE });

		// Alice's slot 4 should be p1.
		assert.deepEqual(getRawInferences(state.hands[PLAYER.ALICE][3]), ['p1'].map(expandShortCard));
	});
});
