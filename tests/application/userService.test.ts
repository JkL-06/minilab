import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { UserService } from '../../src/application/userService';
import { inMemoryUserRepository } from '../support/inMemoryUserRepository';
import { inMemoryLabRepository } from '../support/inMemoryLabRepository';
import { createLab } from '../../src/domain/lab';
import { AuthenticationError, UserNotFoundError } from '../../src/domain/errors';

function setup() {
  const users = inMemoryUserRepository();
  const labs = inMemoryLabRepository();
  const service = new UserService(users, labs);
  return { users, labs, service };
}

describe('UserService', () => {
  it('creates the 0th user as owner', () => {
    const { service, users } = setup();
    const user = service.createFirstUser({ username: 'jkl', password: 'secret123', displayName: 'Kai' });
    assert.equal(user.role, 'owner');
    assert.equal(users.count(), 1);
    assert.equal(user.passwordHash.startsWith('scrypt$'), true);
    assert.notEqual(user.passwordHash, 'secret123');
  });

  it('refuses to create a second first-user', () => {
    const { service } = setup();
    service.createFirstUser({ username: 'jkl', password: 'secret123' });
    assert.throws(() => service.createFirstUser({ username: 'other', password: 'secret123' }), AuthenticationError);
  });

  it('authenticates with the right password and rejects the wrong one', () => {
    const { service } = setup();
    service.createFirstUser({ username: 'jkl', password: 'secret123' });
    const user = service.authenticate('jkl', 'secret123');
    assert.equal(user.username, 'jkl');
    assert.throws(() => service.authenticate('jkl', 'wrong-password'), AuthenticationError);
    assert.throws(() => service.authenticate('nobody', 'secret123'), AuthenticationError);
  });

  it('normalizes username case-insensitively', () => {
    const { service } = setup();
    service.createFirstUser({ username: 'JKL', password: 'secret123' });
    const user = service.authenticate('jkl', 'secret123');
    assert.equal(user.username, 'jkl');
  });

  it('rejects weak passwords at creation', () => {
    const { service } = setup();
    assert.throws(() => service.createFirstUser({ username: 'jkl', password: '123' }));
  });

  it('updates the profile and clears fields with null', () => {
    const { service } = setup();
    const user = service.createFirstUser({ username: 'jkl', password: 'secret123' });
    const updated = service.updateProfile(user.id, { displayName: 'Dr. Kai', bio: 'PI of MiniLab' });
    assert.equal(updated.displayName, 'Dr. Kai');
    assert.equal(updated.bio, 'PI of MiniLab');
    const cleared = service.updateProfile(user.id, { displayName: null, avatar: '🧑‍🔬' });
    assert.equal(cleared.displayName, null);
    assert.equal(cleared.avatar, '🧑‍🔬');
  });

  it('merges preferences by section', () => {
    const { service } = setup();
    const user = service.createFirstUser({ username: 'jkl', password: 'secret123' });
    const step1 = service.updatePreferences(user.id, { voice: { ttsVoice: 'longxiaochun' } });
    assert.deepEqual(step1.preferences.voice, { ttsVoice: 'longxiaochun' });
    const step2 = service.updatePreferences(user.id, { voice: { ttsSpeed: 1.2 }, personalize: { theme: 'dark' } });
    assert.deepEqual(step2.preferences.voice, { ttsVoice: 'longxiaochun', ttsSpeed: 1.2 });
    assert.deepEqual(step2.preferences.personalize, { theme: 'dark' });
  });

  it('changes the password only when the old one matches', () => {
    const { service } = setup();
    const user = service.createFirstUser({ username: 'jkl', password: 'secret123' });
    assert.throws(() => service.changePassword(user.id, 'wrong', 'newpass456'), AuthenticationError);
    service.changePassword(user.id, 'secret123', 'newpass456');
    assert.doesNotThrow(() => service.authenticate('jkl', 'newpass456'));
    assert.throws(() => service.authenticate('jkl', 'secret123'), AuthenticationError);
  });

  it('adopts legacy local-pi labs during first-run migration', () => {
    const { service, labs } = setup();
    labs.insert(createLab({ ownerUserId: 'local-pi', name: '博士规划实验室' }));
    labs.insert(createLab({ ownerUserId: 'other-legacy', name: '另一个' }));
    const owner = service.createFirstUser({ username: 'jkl', password: 'secret123' });
    const adopted = service.adoptLegacyData(owner.id);
    assert.equal(adopted, 1);
    assert.equal(labs.labs.filter((lab) => lab.ownerUserId === owner.id).length, 1);
    assert.equal(labs.labs.filter((lab) => lab.ownerUserId === 'local-pi').length, 0);
  });

  it('throws UserNotFoundError for unknown users', () => {
    const { service } = setup();
    assert.throws(() => service.getUser('nope'), UserNotFoundError);
  });
});
