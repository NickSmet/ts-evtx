/**
 * System tokens for binary XML parsing.
 */
export declare enum SystemToken {
    EndOfStreamToken = 0,
    OpenStartElementToken = 1,
    CloseStartElementToken = 2,
    CloseEmptyElementToken = 3,
    CloseElementToken = 4,
    ValueToken = 5,
    AttributeToken = 6,
    CDataSectionToken = 7,
    EntityReferenceToken = 8,
    ProcessingInstructionTargetToken = 10,
    ProcessingInstructionDataToken = 11,
    TemplateInstanceToken = 12,
    NormalSubstitutionToken = 13,
    ConditionalSubstitutionToken = 14,
    StartOfStreamToken = 15
}
/**
 * Binary XML tokens for the new streaming parser architecture.
 * These correspond to the same values as SystemToken but with cleaner naming.
 */
export declare enum BXmlToken {
    EndOfStream = 0,
    OpenStartElement = 1,
    CloseStartElement = 2,
    CloseEmptyElement = 3,
    CloseElement = 4,
    Value = 5,
    Attribute = 6,
    CDataSection = 7,
    EntityReference = 8,
    ProcessingInstructionTarget = 10,
    ProcessingInstructionData = 11,
    TemplateInstance = 12,
    NormalSubstitution = 13,
    OptionalSubstitution = 14,
    StartOfStream = 15,
    Name = 255,
    FragmentHeader = 16
}
/**
 * Variant types for substitution values.
 */
export declare enum VariantType {
    Null = 0,
    WString = 1,
    String = 2,
    SignedByte = 3,
    UnsignedByte = 4,
    SignedWord = 5,
    UnsignedWord = 6,
    SignedDWord = 7,
    UnsignedDWord = 8,
    SignedQWord = 9,
    UnsignedQWord = 10,
    Float = 11,
    Double = 12,
    Boolean = 13,
    Binary = 14,
    Guid = 15,
    Size = 16,
    FileTime = 17,
    SystemTime = 18,
    Sid = 19,
    Hex32 = 20,
    Hex64 = 21,
    BXml = 33,
    WStringArray = 129
}
