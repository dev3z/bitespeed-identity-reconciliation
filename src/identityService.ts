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

  const allRelatedContacts = await getAllRelatedContacts(matches);

  const primaries = getUniquePrimaries(allRelatedContacts);

  if (primaries.length === 0) {
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
    const primary = primaries[0];
    const family = allRelatedContacts.filter(
      c => c.id === primary.id || c.linkedId === primary.id
    );

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

  return await mergePrimaries(primaries, allRelatedContacts, email, phoneNumber);
}

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

    if (contact.linkedId) {
      const primary = await prisma.contact.findUnique({
        where: { id: contact.linkedId },
      });
      if (primary && !processed.has(primary.id)) {
        toProcess.push(primary);
      }
    }

    if (contact.linkPrecedence === 'primary') {
      const secondaries = await prisma.contact.findMany({
        where: { linkedId: contact.id, deletedAt: null },
      });
      secondaries.forEach(s => {
        if (!processed.has(s.id)) toProcess.push(s);
      });
    }
  }

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
  
    if (contact.linkPrecedence === 'primary') {
      primaryMap.set(contact.id, contact);
    }
  });

  return Array.from(primaryMap.values()).sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );
}

function shouldCreateSecondary(
  family: Contact[],
  email?: string,
  phoneNumber?: string
): boolean {
  const exactMatch = family.some(
    c => c.email === email && c.phoneNumber === phoneNumber
  );
  
  if (exactMatch) return false;

  const hasEmail = family.some(c => c.email === email);
  const hasPhone = family.some(c => c.phoneNumber === phoneNumber);

  if (email && phoneNumber) {
    return !hasEmail || !hasPhone;
  }

  if (email && !hasEmail) return true;
  if (phoneNumber && !hasPhone) return true;

  return false;
}

async function mergePrimaries(
  primaries: Contact[],
  allContacts: Contact[],
  email?: string,
  phoneNumber?: string
): Promise<IdentifyResponse> {
  
  const oldestPrimary = primaries.reduce((oldest, current) =>
    current.createdAt < oldest.createdAt ? current : oldest
  );

  const otherPrimaries = primaries.filter(p => p.id !== oldestPrimary.id);

  for (const primary of otherPrimaries) {
    await prisma.contact.update({
      where: { id: primary.id },
      data: {
        linkedId: oldestPrimary.id,
        linkPrecedence: 'secondary',
        updatedAt: new Date(),
      },
    });

    await prisma.contact.updateMany({
      where: { linkedId: primary.id },
      data: { linkedId: oldestPrimary.id },
    });
  }

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

function buildResponse(contacts: Contact[]): IdentifyResponse {
  const primary = contacts.find(c => c.linkPrecedence === 'primary')!;
  const secondaries = contacts.filter(c => c.linkPrecedence === 'secondary');

  const emails: string[] = [];
  if (primary.email) emails.push(primary.email);
  secondaries.forEach(c => {
    if (c.email && !emails.includes(c.email)) {
      emails.push(c.email);
    }
  });

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