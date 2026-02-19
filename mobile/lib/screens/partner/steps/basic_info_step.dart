import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/screens/partner/working_hours_screen.dart';

/// Step 3: Basic Information
/// Collects establishment name, description, contacts, price range and attributes
/// Based on Figma design: Description frame
class BasicInfoStep extends StatefulWidget {
  const BasicInfoStep({super.key});

  @override
  State<BasicInfoStep> createState() => _BasicInfoStepState();
}

class _BasicInfoStepState extends State<BasicInfoStep> {
  late TextEditingController _nameController;
  late TextEditingController _descriptionController;
  late TextEditingController _phoneController;
  late TextEditingController _linkController;

  // Figma colors
  static const Color _primaryOrange = AppTheme.primaryOrangeDark;
  static const Color _lightOrange = AppTheme.primaryOrangeLight;
  static const Color _greyStroke = Color(0xFFD2D2D2);
  static const Color _greyText = Color(0xFF9D9D9D);

  static const int _maxDescriptionLength = 450;

  @override
  void initState() {
    super.initState();
    final provider = context.read<PartnerRegistrationProvider>();
    _nameController = TextEditingController(text: provider.data.name ?? '');
    _descriptionController =
        TextEditingController(text: provider.data.description ?? '');
    _phoneController = TextEditingController(text: provider.data.phone ?? '');
    _linkController =
        TextEditingController(text: provider.data.instagram ?? '');
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _phoneController.dispose();
    _linkController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<PartnerRegistrationProvider>(
      builder: (context, provider, child) {
        return SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 8),

              // Section header
              _buildSectionHeader(
                'О заведении',
                'Ведите основную информацию',
              ),

              const SizedBox(height: 24),

              // Name field
              _buildFieldSection(
                title: 'Название',
                description:
                    'Добавьте название вашего заведения, допускается кириллица и латиница',
                isRequired: true,
                child: _buildTextField(
                  controller: _nameController,
                  hint: 'Название',
                  onChanged: (value) => provider.updateBasicInfo(name: value),
                ),
              ),

              // Description field
              _buildFieldSection(
                title: 'Описание',
                description:
                    'Добавьте описание вашего заведения, расскажите о его истории, кухне или о чем пожелаете нужным',
                isRequired: false,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      '${_descriptionController.text.length}/$_maxDescriptionLength символов',
                      style: const TextStyle(
                        fontSize: 13,
                        color: _greyText,
                      ),
                    ),
                    const SizedBox(height: 8),
                    _buildTextField(
                      controller: _descriptionController,
                      hint: 'Начните писать...',
                      maxLines: 3,
                      maxLength: _maxDescriptionLength,
                      onChanged: (value) {
                        setState(() {});
                        provider.updateBasicInfo(description: value);
                      },
                    ),
                  ],
                ),
              ),

              // Phone field
              _buildFieldSection(
                title: 'Номер для связи',
                description:
                    'Добавьте номер телефона для связи клиента с вами',
                isRequired: true,
                child: _buildTextField(
                  controller: _phoneController,
                  hint: 'Телефон',
                  keyboardType: TextInputType.phone,
                  onChanged: (value) => provider.updateBasicInfo(phone: value),
                ),
              ),

              // Social link field
              _buildFieldSection(
                title: 'Ссылка на соц. сеть/сайт',
                description:
                    'Оставьте дополнительную ссылку на ваше заведение: так клиенты больше узнают о вас',
                isRequired: false,
                child: _buildTextField(
                  controller: _linkController,
                  hint: 'Ссылка',
                  keyboardType: TextInputType.url,
                  onChanged: (value) =>
                      provider.updateBasicInfo(instagram: value),
                ),
              ),

              // Working hours
              _buildFieldSection(
                title: 'Время работы',
                description:
                    'Укажите время работы вашего заведения по дням недели',
                isRequired: false,
                child: _buildWorkingHoursButton(provider),
              ),

              // Price range
              _buildFieldSection(
                title: 'Средний чек',
                description:
                    'Заполните форму для определения ценовой категории',
                isRequired: true,
                child: _buildPriceRangeSelector(provider),
              ),

              // Attributes
              _buildFieldSection(
                title: 'Атрибуты заведения',
                description:
                    'Выберете несколько атрибутов, которые представлены в вашем заведении',
                isRequired: false,
                child: _buildAttributesList(provider),
              ),

              const SizedBox(height: 100), // Bottom padding for navigation
            ],
          ),
        );
      },
    );
  }

  /// Build section header with title and subtitle
  Widget _buildSectionHeader(String title, String subtitle) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w500,
            color: Colors.black,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          subtitle,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w400,
            color: Colors.black,
          ),
        ),
        const SizedBox(height: 8),
        const Divider(color: _greyStroke, height: 1),
      ],
    );
  }

  /// Build a field section with title, description and child widget
  Widget _buildFieldSection({
    required String title,
    required String description,
    required bool isRequired,
    required Widget child,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 24),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(
                title,
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w500,
                  color: Colors.black,
                ),
              ),
            ),
            if (isRequired)
              const Text(
                '*',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w500,
                  color: _lightOrange,
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          description,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w400,
            color: Colors.black,
          ),
        ),
        const SizedBox(height: 16),
        child,
        const SizedBox(height: 16),
        const Divider(color: _greyStroke, height: 1),
      ],
    );
  }

  /// Build styled text field matching Figma design
  Widget _buildTextField({
    required TextEditingController controller,
    required String hint,
    int maxLines = 1,
    int? maxLength,
    TextInputType keyboardType = TextInputType.text,
    required ValueChanged<String> onChanged,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: _greyStroke),
      ),
      child: TextField(
        controller: controller,
        maxLines: maxLines,
        maxLength: maxLength,
        keyboardType: keyboardType,
        style: const TextStyle(
          fontSize: 15,
          color: Colors.black,
        ),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: const TextStyle(
            fontSize: 15,
            color: _greyText,
          ),
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 14,
          ),
          border: InputBorder.none,
          counterText: '', // Hide default counter
        ),
        onChanged: onChanged,
      ),
    );
  }

  /// Build working hours button
  Widget _buildWorkingHoursButton(PartnerRegistrationProvider provider) {
    final hours = provider.weeklyWorkingHours;
    final hasHours = hours.hasAnyHours;

    return GestureDetector(
      onTap: () => _openWorkingHoursScreen(provider),
      child: Container(
        width: double.infinity,
        height: 48,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: _greyStroke),
        ),
        alignment: Alignment.center,
        child: Text(
          hasHours ? 'Изменить' : 'Заполнить',
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w500,
            color: Colors.black,
          ),
        ),
      ),
    );
  }

  /// Open working hours screen
  Future<void> _openWorkingHoursScreen(
      PartnerRegistrationProvider provider) async {
    final result = await Navigator.of(context).push<WeeklyWorkingHours>(
      MaterialPageRoute(
        builder: (context) => WorkingHoursScreen(
          initialHours: provider.weeklyWorkingHours,
        ),
      ),
    );

    if (result != null) {
      provider.updateWeeklyWorkingHours(result);
    }
  }

  /// Build price range selector
  Widget _buildPriceRangeSelector(PartnerRegistrationProvider provider) {
    final selectedRange = provider.data.priceRange;

    return Row(
      children: [
        _buildPriceOption('\$', selectedRange == '\$', () {
          provider.updateBasicInfo(priceRange: '\$');
        }),
        const SizedBox(width: 12),
        _buildPriceOption('\$\$', selectedRange == '\$\$', () {
          provider.updateBasicInfo(priceRange: '\$\$');
        }),
        const SizedBox(width: 12),
        _buildPriceOption('\$\$\$', selectedRange == '\$\$\$', () {
          provider.updateBasicInfo(priceRange: '\$\$\$');
        }),
      ],
    );
  }

  /// Build individual price option button
  Widget _buildPriceOption(
    String label,
    bool isSelected,
    VoidCallback onTap,
  ) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          height: 48,
          decoration: BoxDecoration(
            color: isSelected ? _primaryOrange : Colors.white,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isSelected ? _primaryOrange : _greyStroke,
            ),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w500,
              color: isSelected ? Colors.white : Colors.black,
            ),
          ),
        ),
      ),
    );
  }

  /// Build attributes list with switches
  Widget _buildAttributesList(PartnerRegistrationProvider provider) {
    return Column(
      children: AttributeOptions.items.map((attribute) {
        final isSelected = provider.isAttributeSelected(attribute.id);
        return _buildAttributeSwitch(
          label: attribute.name,
          value: isSelected,
          onChanged: (value) => provider.toggleAttribute(attribute.id),
        );
      }).toList(),
    );
  }

  /// Build individual attribute switch row
  Widget _buildAttributeSwitch({
    required String label,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: _greyStroke),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w400,
              color: Colors.black,
            ),
          ),
          Switch(
            value: value,
            onChanged: onChanged,
            activeThumbColor: Colors.white,
            activeTrackColor: _lightOrange,
            inactiveThumbColor: Colors.white,
            inactiveTrackColor: _greyStroke,
          ),
        ],
      ),
    );
  }
}
