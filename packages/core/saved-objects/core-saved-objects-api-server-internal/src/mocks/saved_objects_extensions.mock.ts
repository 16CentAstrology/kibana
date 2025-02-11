/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import type {
  ISavedObjectsEncryptionExtension,
  ISavedObjectsSecurityExtension,
  ISavedObjectsSpacesExtension,
  SavedObjectsExtensions,
} from '@kbn/core-saved-objects-server';

const createEncryptionExtension = (): jest.Mocked<ISavedObjectsEncryptionExtension> => ({
  isEncryptableType: jest.fn(),
  decryptOrStripResponseAttributes: jest.fn(),
  encryptAttributes: jest.fn(),
});

const createSecurityExtension = (): jest.Mocked<ISavedObjectsSecurityExtension> => ({
  checkAuthorization: jest.fn(),
  enforceAuthorization: jest.fn(),
  addAuditEvent: jest.fn(),
  redactNamespaces: jest.fn(),
});

const createSpacesExtension = (): jest.Mocked<ISavedObjectsSpacesExtension> => ({
  getCurrentNamespace: jest.fn(),
  getSearchableNamespaces: jest.fn(),
});

const create = (): jest.Mocked<SavedObjectsExtensions> => ({
  encryptionExtension: createEncryptionExtension(),
  securityExtension: createSecurityExtension(),
  spacesExtension: createSpacesExtension(),
});

export const savedObjectsExtensionsMock = {
  create,
  createEncryptionExtension,
  createSecurityExtension,
  createSpacesExtension,
};
