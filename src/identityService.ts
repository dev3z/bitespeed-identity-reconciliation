import { PrismaClient, Contact } from '@prisma/client';

const prisma = new PrismaClient();

interface IdentifyResponse {
  contact: {
    primaryContactId: number;
    emails: string[];
    phoneNumbers: string[];
    secondaryContactIds: number[];
  };
}

export async function identifyContact(
  email?: string,
  phoneNumber?: string
): Promise<IdentifyResponse> {
  
  // Step 1: Find all matching contacts
  const matches = await prisma.contact.findMany({
    where: {
      OR: [
        email ? { email } : {},
        phoneNumber ? { phoneNumber } : {},
      ].filter(condition => Object.keys(condition).length > 0),
      deletedAt: null,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  // Step 2: Build contact families (get all related contacts)
  const allRelatedContacts = await getAllRelatedContacts(matches);

  // Step 3: Get unique primary contacts
  const primaries = getUniquePrimaries(allRelatedContacts);

  // Step 4: Decision tree based on number of primaries found
  if (primaries.length === 0) {
    // No existing contact - create new primary
    const newContact = await prisma.contact.create({
      data: {
        email,
        phoneNumber,
        linkPrecedence: 'primary',
      },
    });
    return buildResponse([newContact]);
  }

  if (primaries.length === 1) {
    // One family found
    const primary = primaries[0];
    const family = allRelatedContacts.filter(
      c => c.id === primary.id || c.linkedId === primary.id
    );

    // Check if we need to create a new secondary
    const needsNewSecondary = shouldCreateSecondary(family, email, phoneNumber);
    
    if (needsNewSecondary) {
      const newSecondary = await prisma.contact.create({
        data: {
          email,
          phoneNumber,
          linkedId: primary.id,
          linkPrecedence: 'secondary',
        },
      });
      family.push(newSecondary);
    }

    return buildResponse(family);
  }

  // Multiple primaries found - need to merge
  return await mergePrimaries(primaries, allRelatedContacts, email, phoneNumber);
}

// Helper: Get all contacts in the same family
async function getAllRelatedContacts(matches: Contact[]): Promise<Contact[]> {
  if (matches.length === 0) return [];

  const contactIds = new Set<number>();
  const toProcess = [...matches];
  const processed = new Set<number>();

  while (toProcess.length > 0) {
    const contact = toProcess.pop()!;
    if (processed.has(contact.id)) continue;
    
    processed.add(contact.id);
    contactIds.add(contact.id);

    // Find primary if this is secondary
    if (contact.linkedId) {
      const primary = await prisma.contact.findUnique({
        where: { id: contact.linkedId },
      });
      if (primary && !processed.has(primary.id)) {
        toProcess.push(primary);
      }
    }

    // Find all secondaries if this is primary
    if (contact.linkPrecedence === 'primary') {
      const secondaries = await prisma.contact.findMany({
        where: { linkedId: contact.id, deletedAt: null },
      });
      secondaries.forEach(s => {
        if (!processed.has(s.id)) toProcess.push(s);
      });
    }
  }

  // Fetch all related contacts
  return await prisma.contact.findMany({
    where: {
      id: { in: Array.from(contactIds) },
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
  });
}

// Helper: Extract unique primary contacts
function getUniquePrimaries(contacts: Contact[]): Contact[] {
  const primaryMap = new Map<number, Contact>();
  
  contacts.forEach(contact => {
    if (contact.linkPrecedence === 'primary') {
      primaryMap.set(contact.id, contact);
    }
  });

  return Array.from(primaryMap.values()).sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );
}

// Helper: Check if we need to create a new secondary
function shouldCreateSecondary(
  family: Contact[],
  email?: string,
  phoneNumber?: string
): boolean {
  // Don't create if this exact combination exists
  const exactMatch = family.some(
    c => c.email === email && c.phoneNumber === phoneNumber
  );
  
  if (exactMatch) return false;

  // Create secondary if we have new information
  const hasEmail = family.some(c => c.email === email);
  const hasPhone = family.some(c => c.phoneNumber === phoneNumber);

  // If both are provided and at least one is new, create secondary
  if (email && phoneNumber) {
    return !hasEmail || !hasPhone;
  }

  // If only one is provided and it's new, create secondary
  if (email && !hasEmail) return true;
  if (phoneNumber && !hasPhone) return true;

  return false;
}

// Helper: Merge multiple primary contacts
async function mergePrimaries(
  primaries: Contact[],
  allContacts: Contact[],
  email?: string,
  phoneNumber?: string
): Promise<IdentifyResponse> {
  
  // Find the oldest primary (this becomes the main primary)
  const oldestPrimary = primaries.reduce((oldest, current) =>
    current.createdAt < oldest.createdAt ? current : oldest
  );

  // Convert all other primaries to secondary
  const otherPrimaries = primaries.filter(p => p.id !== oldestPrimary.id);

  for (const primary of otherPrimaries) {
    // Update the primary to become secondary
    await prisma.contact.update({
      where: { id: primary.id },
      data: {
        linkedId: oldestPrimary.id,
        linkPrecedence: 'secondary',
        updatedAt: new Date(),
      },
    });

    // Update all its children to point to the oldest primary
    await prisma.contact.updateMany({
      where: { linkedId: primary.id },
      data: { linkedId: oldestPrimary.id },
    });
  }

  // Fetch updated family
  const updatedFamily = await prisma.contact.findMany({
    where: {
      OR: [
        { id: oldestPrimary.id },
        { linkedId: oldestPrimary.id },
      ],
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
  });

  // Check if we need to create a new secondary for this combo
  const needsNewSecondary = shouldCreateSecondary(updatedFamily, email, phoneNumber);
  
  if (needsNewSecondary) {
    const newSecondary = await prisma.contact.create({
      data: {
        email,
        phoneNumber,
        linkedId: oldestPrimary.id,
        linkPrecedence: 'secondary',
      },
    });
    updatedFamily.push(newSecondary);
  }

  return buildResponse(updatedFamily);
}

// Helper: Build the final response
function buildResponse(contacts: Contact[]): IdentifyResponse {
  const primary = contacts.find(c => c.linkPrecedence === 'primary')!;
  const secondaries = contacts.filter(c => c.linkPrecedence === 'secondary');

  // Collect unique emails (primary first)
  const emails: string[] = [];
  if (primary.email) emails.push(primary.email);
  secondaries.forEach(c => {
    if (c.email && !emails.includes(c.email)) {
      emails.push(c.email);
    }
  });

  // Collect unique phone numbers (primary first)
  const phoneNumbers: string[] = [];
  if (primary.phoneNumber) phoneNumbers.push(primary.phoneNumber);
  secondaries.forEach(c => {
    if (c.phoneNumber && !phoneNumbers.includes(c.phoneNumber)) {
      phoneNumbers.push(c.phoneNumber);
    }
  });

  return {
    contact: {
      primaryContactId: primary.id,
      emails,
      phoneNumbers,
      secondaryContactIds: secondaries.map(c => c.id),
    },
  };
}