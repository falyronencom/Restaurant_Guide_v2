import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';

/// Step 6: Legal Information Step
/// Allows partner to enter legal/registration data for verification
/// Based on Figma design "Official Info" frame
class LegalInfoStep extends StatefulWidget {
  const LegalInfoStep({super.key});

  @override
  State<LegalInfoStep> createState() => _LegalInfoStepState();
}

class _LegalInfoStepState extends State<LegalInfoStep> {
  late TextEditingController _legalNameController;
  late TextEditingController _unpController;
  late TextEditingController _contactPhoneController;
  late TextEditingController _contactEmailController;
  String? _documentFileName;

  // Figma colors
  static const Color _backgroundColor = Color(0xFFF4F1EC);
  static const Color _greyBorder = Color(0xFFD2D2D2);
  static const Color _greyText = Color(0xFF949494);
  static const Color _requiredRed = Color(0xFFDB4F13);

  @override
  void initState() {
    super.initState();
    final provider = context.read<PartnerRegistrationProvider>();
    _legalNameController = TextEditingController(text: provider.data.legalName ?? '');
    _unpController = TextEditingController(text: provider.data.unp ?? '');
    _contactPhoneController = TextEditingController(text: provider.data.contactPerson ?? '');
    _contactEmailController = TextEditingController(text: provider.data.contactEmail ?? '');

    // Check if document is already uploaded
    if (provider.data.registrationDocumentUrl != null) {
      _documentFileName = 'Документ загружен';
    }
  }

  @override
  void dispose() {
    _legalNameController.dispose();
    _unpController.dispose();
    _contactPhoneController.dispose();
    _contactEmailController.dispose();
    super.dispose();
  }

  void _updateProvider() {
    final provider = context.read<PartnerRegistrationProvider>();
    provider.updateLegalInfo(
      legalName: _legalNameController.text.trim(),
      unp: _unpController.text.trim(),
      contactPerson: _contactPhoneController.text.trim(),
      contactEmail: _contactEmailController.text.trim(),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 8),

          // Section header
          _buildSectionHeader(),

          const SizedBox(height: 24),

          // Legal name field
          _buildFieldSection(
            title: 'Полное название заведения',
            description: 'Введите название заведения, как указано в реестре',
            required: true,
            child: _buildTextField(
              controller: _legalNameController,
              hint: 'Название',
              onChanged: (_) => _updateProvider(),
            ),
          ),

          const SizedBox(height: 24),

          // UNP field
          _buildFieldSection(
            title: 'УНП',
            description: 'Введите УНП вашего заведения',
            required: true,
            child: _buildTextField(
              controller: _unpController,
              hint: '9 символов',
              keyboardType: TextInputType.number,
              maxLength: 9,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              onChanged: (_) => _updateProvider(),
            ),
          ),

          const SizedBox(height: 24),

          // Registration document upload
          _buildFieldSection(
            title: 'Регистрация',
            description: 'Загрузить свидетельство о регистрации, предпочтительнее единый файл PDF',
            required: true,
            child: _buildDocumentUpload(),
          ),

          const SizedBox(height: 24),

          // Contact phone field
          _buildFieldSection(
            title: 'Номер контактного лица',
            description: 'Добавьте номер телефона для связи с вами',
            required: true,
            child: _buildTextField(
              controller: _contactPhoneController,
              hint: 'Телефон',
              keyboardType: TextInputType.phone,
              onChanged: (_) => _updateProvider(),
            ),
          ),

          const SizedBox(height: 24),

          // Contact email field
          _buildFieldSection(
            title: 'E-mail',
            description: 'Добавьте e-mail для связи с вами',
            required: true,
            child: _buildTextField(
              controller: _contactEmailController,
              hint: 'E-mail',
              keyboardType: TextInputType.emailAddress,
              onChanged: (_) => _updateProvider(),
            ),
          ),

          const SizedBox(height: 40),
        ],
      ),
    );
  }

  /// Build section header with title and subtitle
  Widget _buildSectionHeader() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Title
        const Text(
          'Ваши данные',
          style: TextStyle(
            fontFamily: 'Unbounded',
            fontSize: 22,
            fontWeight: FontWeight.w400,
            color: Colors.black,
          ),
        ),
        const SizedBox(height: 8),
        // Subtitle
        const Text(
          'Введите необходимые данные для вашей верификации',
          style: TextStyle(
            fontFamily: 'Avenir Next',
            fontSize: 15,
            fontWeight: FontWeight.w400,
            color: _greyText,
            height: 1.4,
          ),
        ),
        const SizedBox(height: 16),
        // Divider
        Container(
          height: 1,
          color: _greyBorder,
        ),
      ],
    );
  }

  /// Build field section with title, description, and child widget
  Widget _buildFieldSection({
    required String title,
    required String description,
    required bool required,
    required Widget child,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Title with required marker
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(
                title,
                style: const TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: Colors.black,
                ),
              ),
            ),
            if (required)
              const Text(
                '*',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: _requiredRed,
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        // Description
        Text(
          description,
          style: const TextStyle(
            fontFamily: 'Avenir Next',
            fontSize: 14,
            fontWeight: FontWeight.w400,
            color: _greyText,
            height: 1.4,
          ),
        ),
        const SizedBox(height: 16),
        // Child widget (field)
        child,
        const SizedBox(height: 16),
        // Divider
        Container(
          height: 1,
          color: _greyBorder,
        ),
      ],
    );
  }

  /// Build text field
  Widget _buildTextField({
    required TextEditingController controller,
    required String hint,
    TextInputType? keyboardType,
    int? maxLength,
    List<TextInputFormatter>? inputFormatters,
    required ValueChanged<String> onChanged,
  }) {
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: _greyBorder),
        borderRadius: BorderRadius.circular(8),
      ),
      child: TextField(
        controller: controller,
        keyboardType: keyboardType,
        maxLength: maxLength,
        inputFormatters: inputFormatters,
        style: const TextStyle(
          fontFamily: 'Avenir Next',
          fontSize: 16,
          color: Colors.black,
        ),
        decoration: InputDecoration(
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          hintText: hint,
          hintStyle: const TextStyle(
            fontFamily: 'Avenir Next',
            fontSize: 16,
            color: _greyText,
          ),
          counterText: '', // Hide character counter
        ),
        onChanged: onChanged,
      ),
    );
  }

  /// Build document upload section
  Widget _buildDocumentUpload() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Format info
        const Center(
          child: Text(
            'Формат PDF/PNG/JPG, до 60 мб',
            style: TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 13,
              color: _greyText,
            ),
          ),
        ),
        const SizedBox(height: 12),
        // Upload button
        GestureDetector(
          onTap: _showDocumentUploadPlaceholder,
          child: Container(
            width: double.infinity,
            height: 45,
            decoration: BoxDecoration(
              border: Border.all(color: _greyBorder),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Center(
              child: Text(
                _documentFileName ?? '+ Загрузить',
                style: TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                  color: _documentFileName != null ? Colors.black : _greyText,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// Show placeholder for document upload
  void _showDocumentUploadPlaceholder() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: _backgroundColor,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
        title: const Text(
          'Загрузка документов',
          style: TextStyle(
            fontFamily: 'Avenir Next',
            fontWeight: FontWeight.w600,
          ),
        ),
        content: const Text(
          'Загрузка документов будет доступна в следующей версии приложения.\n\nПока вы можете отправить документ на email после регистрации.',
          style: TextStyle(fontFamily: 'Avenir Next'),
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              // Simulate document selected for demo
              setState(() {
                _documentFileName = 'Документ выбран (демо)';
              });
              // Update provider with placeholder URL
              final provider = context.read<PartnerRegistrationProvider>();
              provider.updateLegalInfo(
                registrationDocumentUrl: 'pending_upload',
              );
            },
            child: const Text(
              'Выбрать позже',
              style: TextStyle(
                fontFamily: 'Avenir Next',
                color: _greyText,
              ),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text(
              'Понятно',
              style: TextStyle(
                fontFamily: 'Avenir Next',
                color: _requiredRed,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
